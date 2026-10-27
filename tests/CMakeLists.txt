# ==============================================================================
# CME Test Suite
# ==============================================================================

# Version unit test
add_executable(version_test
    backend/version_test.cpp
)
target_link_libraries(version_test PRIVATE cme_core)
target_compile_features(version_test PRIVATE cxx_std_23)
add_test(NAME version_test COMMAND version_test)

# Smoke test (validates C++23 std::expected and monadic ops)
add_executable(smoke_test
    backend/smoke_test.cpp
)
target_link_libraries(smoke_test PRIVATE cme_core)
target_compile_features(smoke_test PRIVATE cxx_std_23)
add_test(NAME smoke_test COMMAND smoke_test)

# Database & DAG Permissions test
add_executable(db_permissions_dag_test
    backend/db_permissions_dag_test.cpp
)
target_link_libraries(db_permissions_dag_test PRIVATE cme_core)
target_compile_features(db_permissions_dag_test PRIVATE cxx_std_23)
add_test(NAME db_permissions_dag_test COMMAND db_permissions_dag_test)
set_tests_properties(db_permissions_dag_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# POSIX Storage Abstraction Layer test
add_executable(posix_storage_sal_test
    backend/posix_storage_sal_test.cpp
)
target_link_libraries(posix_storage_sal_test PRIVATE cme_core)
target_compile_features(posix_storage_sal_test PRIVATE cxx_std_23)
add_test(NAME posix_storage_sal_test COMMAND posix_storage_sal_test)
set_tests_properties(posix_storage_sal_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Server Daemon & Health Probe test
add_executable(server_health_test
    backend/server_health_test.cpp
)
target_link_libraries(server_health_test PRIVATE cme_core)
target_compile_features(server_health_test PRIVATE cxx_std_23)
add_test(NAME server_health_test COMMAND server_health_test)
set_tests_properties(server_health_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Authentication & Authorization Engine test
add_executable(auth_engine_test
    backend/auth_engine_test.cpp
)
target_link_libraries(auth_engine_test PRIVATE cme_core)
target_compile_features(auth_engine_test PRIVATE cxx_std_23)
add_test(NAME auth_engine_test COMMAND auth_engine_test)
set_tests_properties(auth_engine_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Document & Workspace Tree REST API test
add_executable(document_workspace_api_test
    backend/document_workspace_api_test.cpp
)
target_link_libraries(document_workspace_api_test PRIVATE cme_core)
target_compile_features(document_workspace_api_test PRIVATE cxx_std_23)
add_test(NAME document_workspace_api_test COMMAND document_workspace_api_test)
set_tests_properties(document_workspace_api_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Markdown to Semantic HTML Renderer test (Step 2.4)
add_executable(markdown_renderer_test
    backend/markdown_renderer_test.cpp
)
target_link_libraries(markdown_renderer_test PRIVATE cme_core)
target_compile_features(markdown_renderer_test PRIVATE cxx_std_23)
add_test(NAME markdown_renderer_test COMMAND markdown_renderer_test)
set_tests_properties(markdown_renderer_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# User & Team Administration Engine test (Step 2.5)
add_executable(admin_management_test
    backend/admin_management_test.cpp
)
target_link_libraries(admin_management_test PRIVATE cme_core)
target_compile_features(admin_management_test PRIVATE cxx_std_23)
add_test(NAME admin_management_test COMMAND admin_management_test)
set_tests_properties(admin_management_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Native Yjs CRDT C-FFI Integration test (Step 3.1)
add_executable(ycrdt_cffi_integration_test
    backend/ycrdt_cffi_integration_test.cpp
)
target_link_libraries(ycrdt_cffi_integration_test PRIVATE cme_core)
target_compile_features(ycrdt_cffi_integration_test PRIVATE cxx_std_23)
add_test(NAME ycrdt_cffi_integration_test COMMAND ycrdt_cffi_integration_test)
set_tests_properties(ycrdt_cffi_integration_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# WebSocket Server & Binary Wire Protocol Multiplexer test (Step 3.2)
add_executable(websocket_collab_test
    backend/websocket_collab_test.cpp
)
target_link_libraries(websocket_collab_test PRIVATE cme_core)
target_compile_features(websocket_collab_test PRIVATE cxx_std_23)
add_test(NAME websocket_collab_test COMMAND websocket_collab_test)
set_tests_properties(websocket_collab_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# In-Memory DocumentRoom Debounced Persistence & Eviction test (Step 3.3)
add_executable(persistence_debounced_test
    backend/persistence_debounced_test.cpp
)
target_link_libraries(persistence_debounced_test PRIVATE cme_core)
target_compile_features(persistence_debounced_test PRIVATE cxx_std_23)
add_test(NAME persistence_debounced_test COMMAND persistence_debounced_test)
set_tests_properties(persistence_debounced_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Review Engine & Real-Time Opcode 0x02 Sync test (Step 3.4)
add_executable(review_engine_test
    backend/review_engine_test.cpp
)
target_link_libraries(review_engine_test PRIVATE cme_core)
target_compile_features(review_engine_test PRIVATE cxx_std_23)
add_test(NAME review_engine_test COMMAND review_engine_test)
set_tests_properties(review_engine_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# LLM Tooling & REST Automation Integration test (Step 7.1)
add_test(NAME e2e_llm_agent_simulation_test COMMAND python3 ${CMAKE_SOURCE_DIR}/tests/e2e_llm_agent_simulation.py)
set_tests_properties(e2e_llm_agent_simulation_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Automated Backups, Consistency Barrier & Disaster Recovery Drill (Step 7.2)
add_test(NAME disaster_recovery_drill_test COMMAND bash ${CMAKE_SOURCE_DIR}/tests/disaster_recovery_drill.sh)
set_tests_properties(disaster_recovery_drill_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Secure Remote Code Snippet Fetcher test (Step 8.4)
add_executable(snippet_fetcher_test
    backend/snippet_fetcher_test.cpp
)
target_link_libraries(snippet_fetcher_test PRIVATE cme_core)
target_compile_features(snippet_fetcher_test PRIVATE cxx_std_23)
add_test(NAME snippet_fetcher_test COMMAND snippet_fetcher_test)
set_tests_properties(snippet_fetcher_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Multi-Instance Lease Protection test (Issue #8)
add_executable(instance_lease_test
    backend/instance_lease_test.cpp
)
target_link_libraries(instance_lease_test PRIVATE cme_core)
target_compile_features(instance_lease_test PRIVATE cxx_std_23)
add_test(NAME instance_lease_test COMMAND instance_lease_test)
set_tests_properties(instance_lease_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Persistence Concurrent Edit Protection test (Issue #20)
add_executable(persistence_concurrent_edit_test
    backend/persistence_concurrent_edit_test.cpp
)
target_link_libraries(persistence_concurrent_edit_test PRIVATE cme_core)
target_compile_features(persistence_concurrent_edit_test PRIVATE cxx_std_23)
add_test(NAME persistence_concurrent_edit_test COMMAND persistence_concurrent_edit_test)
set_tests_properties(persistence_concurrent_edit_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# REST PUT/PATCH Active Room Synchronization test (Issue #21)
add_executable(rest_put_active_room_test
    backend/rest_put_active_room_test.cpp
)
target_link_libraries(rest_put_active_room_test PRIVATE cme_core)
target_compile_features(rest_put_active_room_test PRIVATE cxx_std_23)
add_test(NAME rest_put_active_room_test COMMAND rest_put_active_room_test)
set_tests_properties(rest_put_active_room_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# CRDT Legitimate Edits Acceptance test (Issue #22)
add_executable(crdt_legitimate_edits_test
    backend/crdt_legitimate_edits_test.cpp
)
target_link_libraries(crdt_legitimate_edits_test PRIVATE cme_core)
target_compile_features(crdt_legitimate_edits_test PRIVATE cxx_std_23)
add_test(NAME crdt_legitimate_edits_test COMMAND crdt_legitimate_edits_test)
set_tests_properties(crdt_legitimate_edits_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Backup Barrier Queued Edits Protection test (Issue #23)
add_executable(backup_barrier_queued_edits_test
    backend/backup_barrier_queued_edits_test.cpp
)
target_link_libraries(backup_barrier_queued_edits_test PRIVATE cme_core)
target_compile_features(backup_barrier_queued_edits_test PRIVATE cxx_std_23)
add_test(NAME backup_barrier_queued_edits_test COMMAND backup_barrier_queued_edits_test)
set_tests_properties(backup_barrier_queued_edits_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Shutdown Lease & Save Ordering Regression test (Issue #24)
add_executable(shutdown_lease_save_order_test
    backend/shutdown_lease_save_order_test.cpp
)
target_link_libraries(shutdown_lease_save_order_test PRIVATE cme_core)
target_compile_features(shutdown_lease_save_order_test PRIVATE cxx_std_23)
add_test(NAME shutdown_lease_save_order_test COMMAND shutdown_lease_save_order_test)
set_tests_properties(shutdown_lease_save_order_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Folder Wildcard Safety Regression test (Issue #25)
add_executable(folder_wildcard_safety_test
    backend/folder_wildcard_safety_test.cpp
)
target_link_libraries(folder_wildcard_safety_test PRIVATE cme_core)
target_compile_features(folder_wildcard_safety_test PRIVATE cxx_std_23)
add_test(NAME folder_wildcard_safety_test COMMAND folder_wildcard_safety_test)
set_tests_properties(folder_wildcard_safety_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Folder Rename Live Room Regression test (Issue #26)
add_executable(folder_rename_live_rooms_test
    backend/folder_rename_live_rooms_test.cpp
)
target_link_libraries(folder_rename_live_rooms_test PRIVATE cme_core)
target_compile_features(folder_rename_live_rooms_test PRIVATE cxx_std_23)
add_test(NAME folder_rename_live_rooms_test COMMAND folder_rename_live_rooms_test)
set_tests_properties(folder_rename_live_rooms_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

# Deleted Document Room Eviction Regression test (Issue #27)
add_executable(deleted_document_eviction_test
    backend/deleted_document_eviction_test.cpp
)
target_link_libraries(deleted_document_eviction_test PRIVATE cme_core)
target_compile_features(deleted_document_eviction_test PRIVATE cxx_std_23)
add_test(NAME deleted_document_eviction_test COMMAND deleted_document_eviction_test)
set_tests_properties(deleted_document_eviction_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)











