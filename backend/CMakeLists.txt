# ==============================================================================
# CME Core Backend Library & Executable
# ==============================================================================

add_library(cme_core
    src/version.cpp
)

target_include_directories(cme_core
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
)

target_compile_features(cme_core PUBLIC cxx_std_23)

target_compile_definitions(cme_core
    PUBLIC
        CME_VERSION_MAJOR=${PROJECT_VERSION_MAJOR}
        CME_VERSION_MINOR=${PROJECT_VERSION_MINOR}
        CME_VERSION_PATCH=${PROJECT_VERSION_PATCH}
        CME_VERSION_STRING="${PROJECT_VERSION}"
)

# CME Server Executable
add_executable(cme-server
    src/main.cpp
)

target_link_libraries(cme-server
    PRIVATE
        cme_core
)

target_compile_features(cme-server PRIVATE cxx_std_23)

set_target_properties(cme-server PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)
