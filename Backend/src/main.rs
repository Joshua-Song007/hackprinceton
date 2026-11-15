// Starts the HTTP API; the WebSocket game server (/play) and /api routes are added by later 4.2 items.
use pear_backend::db::Db;
use pear_backend::memstore::MemStore;
use pear_backend::{app_with_studio, db as database};
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() {
    pear_backend::api::status::mark_started();
    // `pear-backend storage-check`: ensure the bucket exists, then write/read/delete a probe object. Prints the
    // storage description and the result only (never a key); exit 0 on success, 1 on failure.
    if std::env::args().nth(1).as_deref() == Some("storage-check") {
        let b = pear_backend::blobs::blobs();
        println!("storage: {}", b.describe());
        let r = match b.ensure_bucket().await {
            Ok(()) => b.probe().await,
            Err(e) => Err(e),
        };
        match r {
            Ok(()) => println!("storage-check: ok"),
            Err(e) => {
                println!("storage-check: FAILED: {e}");
                std::process::exit(1);
            }
        }
        std::process::exit(0);
    }
    // Pool is lazy: no connection is attempted until a query runs, so startup never panics.
    let db = match std::env::var("DATABASE_URL") {
        Ok(url) => match PgPoolOptions::new().connect_lazy(&url) {
            Ok(pool) => Some(Db::Pg(pool)),
            Err(e) => {
                eprintln!("DATABASE_URL invalid, starting without a database: {e}");
                None
            }
        },
        Err(_) => {
            eprintln!("DATABASE_URL not set, using the in-memory store (data is lost on restart)");
            Some(Db::Mem(MemStore::default()))
        }
    };

    if let Some(Db::Pg(pool)) = &db {
        if let Err(e) = database::migrate(pool).await {
            eprintln!("migration failed, continuing: {e}");
        }
    }

    // `pear-backend seed <dir>`: the marketplace seed/publish job. Publishes every plugin dir under
    // <dir> as approved, then exits (non-zero if any plugin failed). Safe to re-run.
    let args: Vec<String> = std::env::args().collect();
    // `pear-backend create-developer <username> "<display name>"`: creates the developer account (or resets
    // its password) and prints its id. The password comes from PEAR_DEVELOPER_PASSWORD, never argv.
    if args.get(1).map(String::as_str) == Some("create-developer") {
        let (Some(username), Some(display_name)) = (args.get(2), args.get(3)) else {
            eprintln!("usage: PEAR_DEVELOPER_PASSWORD=... pear-backend create-developer <username> \"<display name>\" (needs DATABASE_URL)");
            std::process::exit(2);
        };
        let (Ok(password), Some(db @ Db::Pg(_))) = (std::env::var("PEAR_DEVELOPER_PASSWORD"), db.as_ref()) else {
            eprintln!("create-developer: set PEAR_DEVELOPER_PASSWORD and DATABASE_URL (a valid one)");
            std::process::exit(2);
        };
        match pear_backend::api::accounts::create_developer(db, username, display_name, &password).await {
            Ok(a) => {
                println!("{}", a.id);
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("create-developer: {e}");
                std::process::exit(1);
            }
        }
    }
    if args.get(1).map(String::as_str) == Some("seed") {
        let (Some(dir), Some(db)) = (args.get(2), db.as_ref()) else {
            eprintln!("usage: pear-backend seed <plugins dir> (needs a database)");
            std::process::exit(2);
        };
        if matches!(db, Db::Pg(_)) && matches!(pear_backend::blobs::blobs(), pear_backend::blobs::Blobs::Mem(_)) {
            eprintln!("seed: DATABASE_URL is set but PEAR_S3_* is not: bundles would be lost when this job exits");
            std::process::exit(2);
        }
        let (new, unchanged, failed) = pear_backend::api::marketplace::seed(db, std::path::Path::new(dir)).await;
        eprintln!("seed: {new} published, {unchanged} unchanged, {failed} failed");
        std::process::exit(if failed == 0 { 0 } else { 1 });
    }

    let blobs = pear_backend::blobs::blobs();
    eprintln!("storage: {}", blobs.describe());
    if blobs.kind() == "memory" {
        eprintln!("storage: PEAR_S3_* not set, assets and bundles are held in memory and are lost on restart");
    }
    tokio::spawn(async {
        let r = pear_backend::api::status::run_probe().await;
        eprintln!("storage probe: {}", r.reason.as_deref().unwrap_or("ok"));
    });

    let studio_dir = std::env::var("PEAR_STUDIO_DIR").ok().map(std::path::PathBuf::from);
    if let Some(dir) = &studio_dir {
        eprintln!("serving Studio from {}", dir.display());
    }

    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8080);
    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("cannot bind 0.0.0.0:{port}: {e}");
            std::process::exit(1);
        }
    };
    eprintln!("listening on 0.0.0.0:{port}");
    if let Err(e) = axum::serve(listener, app_with_studio(db, studio_dir)).await {
        eprintln!("server error: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use pear_backend::app;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // tower is not a direct dependency, so /health is exercised over a loopback socket.
    #[tokio::test]
    async fn health_returns_200_ok() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app(None)).await;
        });
        let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
        s.write_all(b"GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).await.unwrap();
        assert!(buf.starts_with("HTTP/1.1 200"), "{buf}");
        assert!(buf.ends_with("ok"), "{buf}");
    }
}
