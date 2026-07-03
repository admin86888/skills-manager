//! Object-level three-way merge of the skills library (merge-engine design,
//! `docs/merge-engine-design.md`). Phase 3d-α: protocol markers on every app
//! commit + the object merge engine behind the experimental
//! `merge_engine=object` setting (manual sync only).

pub mod apply;
pub mod decision;
#[cfg(test)]
mod integration_tests;
pub mod pending;
pub mod protocol;
pub mod resolve;
pub mod snapshot;
pub mod treebuild;
pub mod validate;

pub use apply::{MergeSummary, object_merge_pull_unlocked, recover_on_startup};

/// Settings key of the experimental engine switch (§9 3d-α). "object"
/// enables the object merge for manual sync; anything else keeps the
/// line-level system merge.
pub const SETTING_MERGE_ENGINE: &str = "merge_engine";

pub fn object_merge_enabled(store: &crate::core::skill_store::SkillStore) -> bool {
    store
        .get_setting(SETTING_MERGE_ENGINE)
        .ok()
        .flatten()
        .map(|v| v.trim() == "object")
        .unwrap_or(false)
}
