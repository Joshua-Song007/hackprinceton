// Sign in with Apple through the real router, against the in-memory store, with injected keys.
// Tokens are signed here with a test-only RSA key (generated for this file, it signs nothing real);
// the key source serves its public half in the same JWK shape Apple publishes.
// Section A uses an injected key source. Section B points the real `HttpAppleKeys` at a local server.
// No test in section A reads the environment; section B sets NO_PROXY (see there), so it is one test fn.
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::Router;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{encode, Algorithm, DecodingKey, EncodingKey, Header};
use pear_backend::api::apple::{routes_with, AppleKeys, AppleVerifier, HttpAppleKeys, KeyError, KeyFuture};
use pear_backend::api::{accounts, library};
use pear_backend::db::Db;
use pear_backend::memstore::MemStore;
use pear_backend::AppState;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const KID: &str = "test-key-1";
const ISS: &str = "https://appleid.apple.com";
const AUD: &str = "com.pear.player";
const MAC_AUD: &str = "com.pear.mac";
/// Modulus of the test key, base64url (the JWK `n`); the exponent is 65537 ("AQAB").
const MODULUS: &str = "0CqvGhV5N5vSQcuH1q17_KKdYYj2Skc8QTwtZ6t0DQH8NBXONZdshN8HJO-viQ10SJVYHtLpayp2fK76FeEXbLHCpzoy7lB51idjRaomFyqYUwHk07Xn4Iiz0ajO6oypDrStT9CyTfvTFjHJEoiaChuPkdlqbb8oKnyKHIDIP5wRWlJrQWOi24RWyU14XVGSYqEwne1pjZYzWL5NLMRjRbthvs_ByeP-Lv34wpkjdLG0xz8n6VD6gf0EadXuQNan6NVFQCsuGz4TNb-PPLGzCMgNlVGAEWhoniP1JTQ5k518v7McuU0TvTmtQ93T0VQJR4CDGhie4uv2cBtKoxyt7Q";
/// PKCS#1 DER of the test key's private half, hex.
const PRIVATE_DER_HEX: &str = concat!(
"308204a40201000282010100d02aaf1a1579379bd241cb87d6ad7bfca29d6188",
    "f64a473c413c2d67ab740d01fc3415ce35976c84df0724efaf890d744895581e",
    "d2e96b2a767caefa15e1176cb1c2a73a32ee5079d6276345aa26172a985301e4",
    "d3b5e7e088b3d1a8ceea8ca90eb4ad4fd0b24dfbd31631c912889a0a1b8f91d9",
    "6a6dbf282a7c8a1c80c83f9c115a526b4163a2db8456c94d785d519262a1309d",
    "ed698d963358be4d2cc46345bb61becfc1c9e3fe2efdf8c2992374b1b4c73f27",
    "e950fa81fd0469d5ee40d6a7e8d545402b2e1b3e1335bf8f3cb1b308c80d9551",
    "801168689e23f5253439939d7cbfb31cb94d13bd39ad43ddd3d154094780831a",
    "189ee2ebf6701b4aa31caded02030100010282010100973f3c24668fc150ad0e",
    "f3138a6e5854b1ce49ac9ace533dbb643ed54124bbc2c27d118ed72f6340934f",
    "7c8dcdeb756414ccb5cf078d6338e2082b963749699ca6f7784b77efe176f49b",
    "7fac8138d5c23414b39e90186e169d1c91ebe613530a0e4e4652649ef8bc4c9d",
    "a6a4a29bafd84238294f5fddc77326938041bf6c3f92152ff4e35c211a804970",
    "30ca593319d119a78d8a30bdf2523559fdca5d6bcc14ff65efd903e99d999a86",
    "19c3177b347ba84bfc8a9dfcf274404a2baeb2c7c4aacc2f04a659af22227e38",
    "5684d032926227445056ffce67ee736c347c7ff5753952dad44a387f4bb18468",
    "aa1c492ed6420df45466abf894d1c74f8ed3d3b4e18102818100e7a0394a3f12",
    "0df6835a54b19a086c28339142c4d22c01e537f0467f62c13d964ce7887192a7",
    "1e993121e0bcbfd8c3e7bad282a70d96e341afcbb2dde5a4cd82275696d0aaf3",
    "18c59bacbe5dedf090dae616f3fe144a44686f5bd8e04ebb260ec2c2886ba11a",
    "a32e224e142b067b399b31c4bf3b5cd0b6c7f3435a46d274c22102818100e612",
    "7e6638f9f0b68db4d926f91fd5294e6b13a0d395d41379f3e657b7164b6d724c",
    "dccf97754c80dde22d9e3dfcaa6038c357245b7ed224df9d325684b640d218dc",
    "0e81befc1232b3fb261980d23a0fda591ff6181f1e6221616e269537590b0228",
    "9c7edd93c3baf1d580ed9dd20f85b0d74e3e54ee08790acbe7e20b490a4d0281",
    "800d2b30d6a5cb52fbe6efe5cccb231b7315ab768e561ca666efcd3b54d6ba81",
    "d3dfbf722472e0097f5029caeb304514ae4212e1d6b991108e957e1147485d1c",
    "4a000e8e3882df9b52f0ccdb6ddfaf43ad0e53d3bf684be8a3bf610b6d854c62",
    "97883f231e6b64664ea328a940e0f77488fc456151f0aef5155d21412ab1a06d",
    "c102818100c9cf030c8b81c1c17f7f58d334c6d5658c21a46ff7e87ec42ebee0",
    "17a4c36b9a2f1e78b9a6f2ff0e3292c8ccfb367c0437063193f4a5c393108a84",
    "b31b69fa65cfe486dd0c37738702149490de4c891d8abb8eab80f11ae79cbc27",
    "b0b4467e5687a833cd9c7296c78e8566b8072d50ec45f835ebbaf7a87af41b73",
    "e4f55d3629028180166b5d6aea10690cddc5e6cc8b0e4ba01259ff2788af498c",
    "9e04314d571bc4d607fcd6e6b1e222358d8aa2fc0aa70cd713f7b610b6d7874f",
    "602d7e5324dcf395cad15a1fade0bb8ea7eb78d4db6c070c03de02189fe8433e",
    "04700c77fff90a473f67b8f83c312791ad36d77bc98e73de132e636963815ac4",
    "3f331cf0b490d1e7"
);

fn hex_decode(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

fn jwks_json() -> String {
    format!(r#"{{"keys":[{{"kty":"RSA","kid":"{KID}","use":"sig","alg":"RS256","n":"{MODULUS}","e":"AQAB"}}]}}"#)
}

/// Claims of a good token for `sub`: right issuer and audience, ten minutes to live.
fn claims(sub: &str) -> Value {
    json!({"iss": ISS, "aud": AUD, "sub": sub, "iat": now(), "exp": now() + 600})
}

fn sign_with(kid: &str, claims: &Value) -> String {
    let enc = EncodingKey::from_rsa_der(&hex_decode(PRIVATE_DER_HEX));
    let mut h = Header::new(Algorithm::RS256);
    h.kid = Some(kid.to_string());
    encode(&h, claims, &enc).unwrap()
}

fn sign(claims: &Value) -> String {
    sign_with(KID, claims)
}

/// Serves the public half, like `HttpAppleKeys` would after parsing Apple's response.
struct StaticKeys(JwkSet);

impl AppleKeys for StaticKeys {
    fn key<'a>(&'a self, kid: &'a str) -> KeyFuture<'a> {
        Box::pin(async move { Ok(self.0.find(kid).and_then(|j| DecodingKey::from_jwk(j).ok())) })
    }
}

/// A key source that is down.
struct FailingKeys;

impl AppleKeys for FailingKeys {
    fn key<'a>(&'a self, _kid: &'a str) -> KeyFuture<'a> {
        Box::pin(async { Err(KeyError("down".into())) })
    }
}

fn static_keys() -> Arc<dyn AppleKeys> {
    Arc::new(StaticKeys(serde_json::from_str(&jwks_json()).unwrap()))
}

fn verifier(audiences: &[&str]) -> AppleVerifier {
    AppleVerifier::new(static_keys(), audiences.iter().map(|s| s.to_string()).collect())
}

/// accounts (for /me), library, and the Apple route with this verifier, over a fresh in-memory store.
async fn serve(v: AppleVerifier) -> SocketAddr {
    let router = Router::new()
        .merge(accounts::routes())
        .merge(library::routes())
        .merge(routes_with(v))
        .with_state(AppState { db: Some(Db::Mem(MemStore::default())) });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    addr
}

/// One request over a raw socket; returns (status code, JSON body or Null).
async fn call(addr: SocketAddr, method: &str, path: &str, token: Option<&str>, body: Option<&Value>) -> (u16, Value) {
    let auth = token.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let raw = format!(
        "{method} {path} HTTP/1.1\r\nHost: x\r\n{auth}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
    s.write_all(raw.as_bytes()).await.unwrap();
    let mut buf = String::new();
    s.read_to_string(&mut buf).await.unwrap();
    let status = buf.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or_else(|| panic!("bad response: {buf}"));
    let body = buf
        .split_once("\r\n\r\n")
        .and_then(|(_, b)| serde_json::from_str(b.trim()).ok())
        .unwrap_or(Value::Null);
    (status, body)
}

/// POST /api/accounts/apple; `name` is sent as displayName when given.
async fn apple(addr: SocketAddr, identity_token: &str, name: Option<&str>) -> (u16, Value) {
    let mut body = json!({"identityToken": identity_token});
    if let Some(n) = name {
        body["displayName"] = json!(n);
    }
    call(addr, "POST", "/api/accounts/apple", None, Some(&body)).await
}

fn session_token(body: &Value) -> String {
    let t = body["token"].as_str().expect("token in response").to_string();
    assert_eq!(t.len(), 64, "{t}");
    assert!(t.chars().all(|c| c.is_ascii_hexdigit()), "{t}");
    t
}

#[tokio::test]
async fn valid_token_signs_in_and_the_session_works() {
    let addr = serve(verifier(&[AUD])).await;
    let (st, body) = apple(addr, &sign(&claims("001.abc")), Some("Ann")).await;
    assert_eq!(st, 200, "{body}");
    let token = session_token(&body);
    assert_eq!(body["account"]["provider"], "apple");
    assert_eq!(body["account"]["subject"], "001.abc");
    assert_eq!(body["account"]["display_name"], "Ann");
    let (st, me) = call(addr, "GET", "/api/accounts/me", Some(&token), None).await;
    assert_eq!(st, 200, "{me}");
    assert_eq!(me["id"], body["account"]["id"]);
    let (st, library) = call(addr, "GET", "/api/library", Some(&token), None).await;
    assert_eq!((st, library), (200, json!([])));
}

#[tokio::test]
async fn repeat_sign_in_without_a_name_keeps_the_name() {
    let addr = serve(verifier(&[AUD])).await;
    let token = sign(&claims("001.abc"));
    let (st, first) = apple(addr, &token, Some("Ann")).await;
    assert_eq!(st, 200, "{first}");
    let id = first["account"]["id"].clone();

    // Apple sends the name once; later sign-ins carry none, or only blanks.
    for name in [None, Some("   ")] {
        let (st, again) = apple(addr, &token, name).await;
        assert_eq!(st, 200, "{again}");
        assert_eq!(again["account"]["id"], id);
        assert_eq!(again["account"]["display_name"], "Ann", "name {name:?}");
        assert_ne!(session_token(&again), session_token(&first), "each sign-in gets its own session");
    }

    // A new non-empty name replaces it (the existing upsert rule).
    let (_, renamed) = apple(addr, &token, Some("Anna")).await;
    assert_eq!((renamed["account"]["id"].clone(), renamed["account"]["display_name"].clone()), (id, json!("Anna")));
}

#[tokio::test]
async fn a_different_sub_is_a_different_account() {
    let addr = serve(verifier(&[AUD])).await;
    let (_, a) = apple(addr, &sign(&claims("sub-a")), None).await;
    let (_, b) = apple(addr, &sign(&claims("sub-b")), None).await;
    assert_ne!(a["account"]["id"], b["account"]["id"]);
    assert_eq!(b["account"]["subject"], "sub-b");
}

#[tokio::test]
async fn every_configured_audience_is_accepted() {
    let addr = serve(verifier(&[MAC_AUD, AUD])).await;
    for (sub, aud) in [("ios-user", AUD), ("mac-user", MAC_AUD)] {
        let mut c = claims(sub);
        c["aud"] = json!(aud);
        let (st, body) = apple(addr, &sign(&c), None).await;
        assert_eq!(st, 200, "{aud}: {body}");
    }
}

#[tokio::test]
async fn bad_tokens_are_401_with_no_session() {
    let addr = serve(verifier(&[AUD])).await;
    let good = sign(&claims("victim"));

    let mut wrong_aud = claims("victim");
    wrong_aud["aud"] = json!("com.other.app");
    let mut expired = claims("victim");
    expired["exp"] = json!(now() - 3600); // far past the 60 s leeway
    let mut wrong_iss = claims("victim");
    wrong_iss["iss"] = json!("https://evil.example");
    let mut no_sub = claims("victim");
    no_sub.as_object_mut().unwrap().remove("sub");
    let mut forged = good.clone();
    forged.replace_range(forged.len() - 4.., "AAAA");
    assert_ne!(forged, good, "the signature really changed");
    let hs256 = {
        let mut h = Header::new(Algorithm::HS256);
        h.kid = Some(KID.to_string());
        encode(&h, &claims("victim"), &EncodingKey::from_secret(b"not-apples-key").unwrap()).unwrap()
    };

    let cases = [
        ("wrong audience", sign(&wrong_aud)),
        ("expired", sign(&expired)),
        ("bad signature", forged),
        ("wrong issuer", sign(&wrong_iss)),
        ("HS256 algorithm confusion", hs256),
        ("unknown key id", sign_with("some-other-key", &claims("victim"))),
        ("missing sub", sign(&no_sub)),
        ("empty sub", sign(&claims("  "))),
        ("not a jwt", "not.a.jwt".to_string()),
    ];
    for (what, token) in cases {
        let (st, body) = apple(addr, &token, Some("Mallory")).await;
        assert_eq!(st, 401, "{what}: {body}");
        assert!(body.get("token").is_none(), "{what} must not issue a session: {body}");
    }
}

#[tokio::test]
async fn a_key_source_that_is_down_is_502() {
    let addr = serve(AppleVerifier::new(Arc::new(FailingKeys), vec![AUD.to_string()])).await;
    let (st, body) = apple(addr, &sign(&claims("001.abc")), None).await;
    assert_eq!(st, 502, "{body}");
}

#[tokio::test]
async fn without_configured_audiences_no_token_is_accepted() {
    let addr = serve(verifier(&[])).await;
    let (st, body) = apple(addr, &sign(&claims("001.abc")), None).await;
    assert_eq!(st, 503, "{body}");
}

/// A key server that answers every request with `status` and `body`, and counts the requests.
struct KeyServer {
    url: String,
    hits: Arc<AtomicUsize>,
}

async fn key_server(status: &'static str, body: String) -> KeyServer {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/auth/keys", listener.local_addr().unwrap());
    let hits = Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut s, _)) = listener.accept().await else { return };
            let (counter, body) = (counter.clone(), body.clone());
            tokio::spawn(async move {
                // Read the whole request before replying; closing first can reset the connection.
                let mut got = Vec::new();
                let mut buf = [0u8; 2048];
                while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                    match s.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => got.extend_from_slice(&buf[..n]),
                    }
                }
                counter.fetch_add(1, Ordering::SeqCst);
                let reply = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = s.write_all(reply.as_bytes()).await;
            });
        }
    });
    KeyServer { url, hits }
}

async fn serve_http_keys(url: &str) -> SocketAddr {
    serve(AppleVerifier::new(Arc::new(HttpAppleKeys::with_url(url)), vec![AUD.to_string()])).await
}

// One test fn: it sets NO_PROXY, and set_var must not race another test thread reading the environment.
// reqwest honours HTTP_PROXY even with its default features off, which would send these loopback
// fetches to a proxy on any machine that has one configured.
#[tokio::test]
async fn http_key_source_fetches_caches_and_throttles() {
    std::env::set_var("NO_PROXY", "127.0.0.1,localhost");
    std::env::set_var("no_proxy", "127.0.0.1,localhost");

    // One fetch serves later sign-ins; an unknown key id inside the 60 s window does not refetch.
    let server = key_server("200 OK", jwks_json()).await;
    let addr = serve_http_keys(&server.url).await;
    let (st, body) = apple(addr, &sign(&claims("b1")), None).await;
    assert_eq!((st, server.hits.load(Ordering::SeqCst)), (200, 1), "{body}");
    let (st, body) = apple(addr, &sign(&claims("b2")), None).await;
    assert_eq!((st, server.hits.load(Ordering::SeqCst)), (200, 1), "cached: {body}");
    let (st, body) = apple(addr, &sign_with("rotated-key", &claims("b3")), None).await;
    assert_eq!((st, server.hits.load(Ordering::SeqCst)), (401, 1), "throttled: {body}");

    // Nothing listening: 502, and again 502 on the next request (the failed attempt counts).
    let dead = {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        format!("http://{}/auth/keys", l.local_addr().unwrap())
    };
    let addr = serve_http_keys(&dead).await;
    for _ in 0..2 {
        let (st, body) = apple(addr, &sign(&claims("b4")), None).await;
        assert_eq!(st, 502, "{body}");
    }

    // Apple answering with an error status, or with something that is not a key set: 502 (fresh source each).
    for (status, body_text) in [("500 Internal Server Error", "boom".to_string()), ("200 OK", r#"{"nope":1}"#.to_string())] {
        let server = key_server(status, body_text).await;
        let addr = serve_http_keys(&server.url).await;
        let (st, body) = apple(addr, &sign(&claims("b5")), None).await;
        assert_eq!(st, 502, "{status}: {body}");
    }
}
