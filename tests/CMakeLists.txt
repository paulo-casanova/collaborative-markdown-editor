# ==============================================================================
# CME Test Suite
# ==============================================================================

# Version unit test
add_executable(version_test
    backend/version_test.cpp
)
target_link_libraries(version_test PRIVATE cme_core)
target_compile_features(version_test PRIVATE cxx_std_23)
set_target_properties(version_test PROPERTIES
    BUILD_RPATH "/home/pasc/.local/usr/lib:/home/pasc/.local/usr/lib/x86_64-linux-gnu"
)
add_test(NAME version_test COMMAND version_test)

# Smoke test (validates C++23 std::expected and monadic ops)
add_executable(smoke_test
    backend/smoke_test.cpp
)
target_link_libraries(smoke_test PRIVATE cme_core)
target_compile_features(smoke_test PRIVATE cxx_std_23)
set_target_properties(smoke_test PROPERTIES
    BUILD_RPATH "/home/pasc/.local/usr/lib:/home/pasc/.local/usr/lib/x86_64-linux-gnu"
)
add_test(NAME smoke_test COMMAND smoke_test)

# Database & DAG Permissions test
add_executable(db_permissions_dag_test
    backend/db_permissions_dag_test.cpp
)
target_link_libraries(db_permissions_dag_test PRIVATE cme_core)
target_compile_features(db_permissions_dag_test PRIVATE cxx_std_23)
set_target_properties(db_permissions_dag_test PROPERTIES
    BUILD_RPATH "/home/pasc/.local/usr/lib:/home/pasc/.local/usr/lib/x86_64-linux-gnu"
)
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
set_target_properties(posix_storage_sal_test PROPERTIES
    BUILD_RPATH "/home/pasc/.local/usr/lib:/home/pasc/.local/usr/lib/x86_64-linux-gnu"
)
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
set_target_properties(server_health_test PROPERTIES
    BUILD_RPATH "/home/pasc/.local/usr/lib:/home/pasc/.local/usr/lib/x86_64-linux-gnu"
)
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
set_target_properties(auth_engine_test PROPERTIES
    BUILD_RPATH "/home/pasc/.local/usr/lib:/home/pasc/.local/usr/lib/x86_64-linux-gnu"
)
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
set_target_properties(document_workspace_api_test PROPERTIES
    BUILD_RPATH "/home/pasc/.local/usr/lib:/home/pasc/.local/usr/lib/x86_64-linux-gnu"
)
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
set_target_properties(markdown_renderer_test PROPERTIES
    BUILD_RPATH "/home/pasc/.local/usr/lib:/home/pasc/.local/usr/lib/x86_64-linux-gnu"
)
add_test(NAME markdown_renderer_test COMMAND markdown_renderer_test)
set_tests_properties(markdown_renderer_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

