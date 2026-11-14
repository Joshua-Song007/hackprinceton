// Server keys: Ed25519 signing of plugin bundles and AES-256-GCM encryption of per-account model keys.
// OMNI_PLUGIN_SIGNING_KEY and OMNI_SECRET_KEY are 64 hex chars (32 bytes) each. Unset = a random key
// for this process only (dev): signatures and stored model keys stop verifying after a restart, so the
// hosted box must set both (Deploy/vultr-bootstrap.sh writes them to .env).
use std::sync::OnceLock;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use ed25519_dalek::{Signer as _, SigningKey};

fn key_from_env(var: &str) -> [u8; 32] {
    if let Ok(v) = std::env::var(var) {
        match hex::decode(v.trim()).ok().and_then(|b| <[u8; 32]>::try_from(b).ok()) {
            Some(k) => return k,
            None => eprintln!("{var} is not 64 hex chars; using a random key for this process"),
        }
    } else {
        eprintln!("{var} not set; using a random key for this process (lost on restart)");
    }
    let mut k = [0u8; 32];
    getrandom::fill(&mut k).expect("OS randomness unavailable");
    k
}

/// The text a bundle signature covers: plugin id, version and tarball SHA-256 (hex).
pub fn signed_message(id: &str, version: &str, sha256: &str) -> String {
    format!("omni-plugin-v1\n{id}\n{version}\n{sha256}")
}

pub struct Signer(SigningKey);

pub fn signer() -> &'static Signer {
    static S: OnceLock<Signer> = OnceLock::new();
    S.get_or_init(|| Signer(SigningKey::from_bytes(&key_from_env("OMNI_PLUGIN_SIGNING_KEY"))))
}

impl Signer {
    pub fn from_seed(seed: [u8; 32]) -> Signer {
        Signer(SigningKey::from_bytes(&seed))
    }

    /// Hex Ed25519 signature of `signed_message(id, version, sha256)`.
    pub fn sign(&self, id: &str, version: &str, sha256: &str) -> String {
        hex::encode(self.0.sign(signed_message(id, version, sha256).as_bytes()).to_bytes())
    }

    pub fn public_hex(&self) -> String {
        hex::encode(self.0.verifying_key().to_bytes())
    }
}

pub struct SecretBox(Aes256Gcm);

pub fn secret_box() -> &'static SecretBox {
    static S: OnceLock<SecretBox> = OnceLock::new();
    S.get_or_init(|| SecretBox::new(key_from_env("OMNI_SECRET_KEY")))
}

impl SecretBox {
    pub fn new(key: [u8; 32]) -> SecretBox {
        SecretBox(Aes256Gcm::new_from_slice(&key).expect("32-byte key"))
    }

    /// base64(nonce || ciphertext); a fresh random nonce each call.
    pub fn seal(&self, plaintext: &str) -> String {
        let mut nonce = [0u8; 12];
        getrandom::fill(&mut nonce).expect("OS randomness unavailable");
        let ct = self.0.encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes()).expect("aes-gcm encrypt");
        base64::engine::general_purpose::STANDARD.encode([nonce.as_slice(), &ct].concat())
    }

    /// None for anything that does not decrypt (wrong key, tampered, truncated).
    pub fn open(&self, sealed: &str) -> Option<String> {
        let raw = base64::engine::general_purpose::STANDARD.decode(sealed).ok()?;
        if raw.len() < 12 {
            return None;
        }
        let (nonce, ct) = raw.split_at(12);
        String::from_utf8(self.0.decrypt(Nonce::from_slice(nonce), ct).ok()?).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    #[test]
    fn signature_verifies_and_binds_every_field() {
        let s = Signer::from_seed([7; 32]);
        let sig = hex::decode(s.sign("p", "1.0.0", "ab")).unwrap();
        let key = VerifyingKey::from_bytes(&hex::decode(s.public_hex()).unwrap().try_into().unwrap()).unwrap();
        let sig = Signature::from_bytes(&sig.try_into().unwrap());
        assert!(key.verify(signed_message("p", "1.0.0", "ab").as_bytes(), &sig).is_ok());
        assert!(key.verify(signed_message("p", "1.0.1", "ab").as_bytes(), &sig).is_err());
        assert!(key.verify(signed_message("p", "1.0.0", "ac").as_bytes(), &sig).is_err());
    }

    #[test]
    fn secret_box_round_trip_and_rejects_tamper_and_wrong_key() {
        let b = SecretBox::new([1; 32]);
        let sealed = b.seal("sk-test-123");
        assert!(!sealed.contains("sk-test"));
        assert_ne!(sealed, b.seal("sk-test-123"), "fresh nonce per seal");
        assert_eq!(b.open(&sealed).as_deref(), Some("sk-test-123"));
        assert_eq!(SecretBox::new([2; 32]).open(&sealed), None);
        let mut raw = base64::engine::general_purpose::STANDARD.decode(&sealed).unwrap();
        *raw.last_mut().unwrap() ^= 1;
        assert_eq!(b.open(&base64::engine::general_purpose::STANDARD.encode(raw)), None);
        assert_eq!(b.open("x"), None);
    }
}
