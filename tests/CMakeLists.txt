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
