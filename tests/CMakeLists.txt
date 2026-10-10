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
