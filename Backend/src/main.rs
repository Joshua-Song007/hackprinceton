// Starts the HTTP API; the WebSocket game server (/play) and /api routes are added by later 4.2 items.
use axum::{routing::get, Router};
use sqlx::postgres::{PgPool, PgPoolOptions};

/// Shared handler state. `db` is None when DATABASE_URL is unset.
#[derive(Clone)]
#[allow(dead_code)] // read by the db.rs / api items that follow
pub struct AppState {
    pub db: Option<PgPool>,
}

async fn health() -> &'static str {
    "ok"
}

/// Builds the router. Later items mount `/api` (accounts, games) and the `/play` WebSocket here.
pub fn app(db: Option<PgPool>) -> Router {
    Router::new()
        .route("/health", get(health))
        .with_state(AppState { db })
}

#[tokio::main]
async fn main() {
    // Pool is lazy: no connection is attempted until a query runs, so startup never panics.
    let db = match std::env::var("DATABASE_URL") {
        Ok(url) => match PgPoolOptions::new().connect_lazy(&url) {
            Ok(pool) => Some(pool),
            Err(e) => {
                eprintln!("DATABASE_URL invalid, starting without a database: {e}");
                None
            }
        },
        Err(_) => {
            eprintln!("DATABASE_URL not set, starting without a database");
            None
        }
    };

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
    if let Err(e) = axum::serve(listener, app(db)).await {
        eprintln!("server error: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
