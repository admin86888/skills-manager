use std::sync::Arc;

use anyhow::{Context, Result};

use super::{central_repo, scenario_service, skill_store::SkillStore, sync_metadata, tool_service};

pub fn initialize_store() -> Result<Arc<SkillStore>> {
    initialize_store_inner(true)
}

pub fn initialize_cli_store() -> Result<Arc<SkillStore>> {
    initialize_store_inner(false)
}

fn initialize_store_inner(apply_startup_default: bool) -> Result<Arc<SkillStore>> {
    central_repo::ensure_central_repo().context("Failed to create central repo")?;

    let db_path = central_repo::db_path();
    let store = Arc::new(SkillStore::new(&db_path).context("Failed to initialize database")?);
    tool_service::migrate_legacy_tool_keys(&store)
        .map_err(|e| anyhow::anyhow!(e.to_string()))
        .context("Failed to migrate legacy tool keys")?;
    if sync_metadata::metadata_exists() {
        sync_metadata::reindex_from_metadata(&store)
            .context("Failed to reindex from sync metadata")?;
    }
    if scenario_service::restore_all_skills_sync_included(&store)
        .map_err(|e| anyhow::anyhow!(e.to_string()))
        .context("Failed to restore skill sync inclusion")?
    {
        sync_metadata::write_all_from_db(&store)
            .context("Failed to persist restored skill sync inclusion")?;
    }
    if apply_startup_default {
        scenario_service::ensure_default_startup_scenario(&store)
            .map_err(|e| anyhow::anyhow!(e.to_string()))
            .context("Failed to initialize startup scenario")?;
    } else {
        scenario_service::ensure_cli_scenario_state(&store)
            .map_err(|e| anyhow::anyhow!(e.to_string()))
            .context("Failed to initialize CLI scenario state")?;
    }
    Ok(store)
}
