//! Minimal GitHub REST client for the guided backup setup (backup redesign
//! Phase 2, PAT mode): validate a token, then find or create the private
//! backup repository. The token itself never appears in URLs, logs, or error
//! messages — callers store it in the OS keychain.
//!
//! Errors carry stable prefixes (`GITHUB_TOKEN_INVALID`, `GITHUB_SCOPE`,
//! `GITHUB_NETWORK`) the frontend maps to plain-language copy.

use anyhow::{bail, Context, Result};
use serde::Deserialize;

use super::skillssh_api::build_http_client;

const API_BASE: &str = "https://api.github.com";

#[derive(Debug, Clone, serde::Serialize)]
pub struct GithubConnectInfo {
    pub login: String,
    pub repo_full_name: String,
    /// Credential-free HTTPS clone URL.
    pub url: String,
    pub repo_created: bool,
}

#[derive(Deserialize)]
struct UserResp {
    login: String,
}

#[derive(Deserialize)]
struct RepoResp {
    full_name: String,
}

/// GitHub repository name rules (subset): ASCII letters, digits, `-`, `_`,
/// `.`; not empty, not `.`/`..`, max 100 chars.
pub fn is_valid_repo_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && name != "."
        && name != ".."
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn request(
    client: &reqwest::blocking::Client,
    method: reqwest::Method,
    url: &str,
    token: &str,
) -> reqwest::blocking::RequestBuilder {
    client
        .request(method, url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
}

/// Validate the token, then ensure the backup repository exists under the
/// token owner's account (creating it as a private repo when missing).
pub fn connect_backup_repo(
    token: &str,
    repo_name: &str,
    proxy_url: Option<&str>,
) -> Result<GithubConnectInfo> {
    if !is_valid_repo_name(repo_name) {
        bail!("Invalid repository name");
    }
    let client = build_http_client(proxy_url, 20);

    // Who owns this token? Also serves as token validation.
    let resp = request(&client, reqwest::Method::GET, &format!("{API_BASE}/user"), token)
        .send()
        .context("GITHUB_NETWORK: could not reach api.github.com")?;
    let login = match resp.status().as_u16() {
        200 => resp.json::<UserResp>().context("Unexpected /user response")?.login,
        401 => bail!("GITHUB_TOKEN_INVALID: GitHub rejected the token (401)"),
        403 => bail!("GITHUB_TOKEN_INVALID: GitHub denied access (403); the token may lack permissions or be rate-limited"),
        s => bail!("GitHub /user returned HTTP {s}"),
    };

    // Find or create the repository.
    let resp = request(
        &client,
        reqwest::Method::GET,
        &format!("{API_BASE}/repos/{login}/{repo_name}"),
        token,
    )
    .send()
    .context("GITHUB_NETWORK: could not reach api.github.com")?;

    let (repo_created, full_name) = match resp.status().as_u16() {
        200 => (
            false,
            resp.json::<RepoResp>().context("Unexpected repo response")?.full_name,
        ),
        404 => {
            let resp = request(&client, reqwest::Method::POST, &format!("{API_BASE}/user/repos"), token)
                .json(&serde_json::json!({
                    "name": repo_name,
                    "private": true,
                    "auto_init": false,
                    "description": "Skills Manager backup",
                }))
                .send()
                .context("GITHUB_NETWORK: could not reach api.github.com")?;
            match resp.status().as_u16() {
                201 => (
                    true,
                    resp.json::<RepoResp>().context("Unexpected create-repo response")?.full_name,
                ),
                401 => bail!("GITHUB_TOKEN_INVALID: GitHub rejected the token (401)"),
                // Classic PATs without `repo` scope and fine-grained tokens
                // without Administration:write both land here.
                403 | 404 => bail!(
                    "GITHUB_SCOPE: the token cannot create repositories — it needs the 'repo' scope (classic) or Administration: write (fine-grained)"
                ),
                s => bail!("GitHub create-repo returned HTTP {s}"),
            }
        }
        401 => bail!("GITHUB_TOKEN_INVALID: GitHub rejected the token (401)"),
        403 => bail!("GITHUB_SCOPE: the token cannot read this repository (403); grant it access to {login}/{repo_name}"),
        s => bail!("GitHub repo lookup returned HTTP {s}"),
    };

    log::info!(
        "github connect: using repository {full_name} (created={repo_created})"
    );
    Ok(GithubConnectInfo {
        login,
        url: format!("https://github.com/{full_name}.git"),
        repo_full_name: full_name,
        repo_created,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_name_validation() {
        assert!(is_valid_repo_name("skills-manager-backup"));
        assert!(is_valid_repo_name("My_Backup.2026"));
        assert!(!is_valid_repo_name(""));
        assert!(!is_valid_repo_name("."));
        assert!(!is_valid_repo_name(".."));
        assert!(!is_valid_repo_name("has space"));
        assert!(!is_valid_repo_name("has/slash"));
        assert!(!is_valid_repo_name(&"x".repeat(101)));
    }
}
