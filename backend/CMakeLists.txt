# ==============================================================================
# CME Core Backend Library & Executables
# ==============================================================================

find_package(PkgConfig REQUIRED)
set(ENV{PKG_CONFIG_PATH} "$ENV{HOME}/.local/usr/lib/pkgconfig:$ENV{PKG_CONFIG_PATH}")
pkg_check_modules(PQXX REQUIRED IMPORTED_TARGET libpqxx)
pkg_check_modules(PQ REQUIRED IMPORTED_TARGET libpq)

add_library(cme_core
    src/version.cpp
    src/db/connection_pool.cpp
    src/db/migration_runner.cpp
    src/db/permission_engine.cpp
    src/storage/posix_storage_backend.cpp
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

target_link_libraries(cme_core
    PUBLIC
        PkgConfig::PQXX
        PkgConfig::PQ
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

# CME Migration Executable
add_executable(cme-migrate
    src/migrate_main.cpp
)

target_link_libraries(cme-migrate
    PRIVATE
        cme_core
)

target_compile_features(cme-migrate PRIVATE cxx_std_23)

set_target_properties(cme-server cme-migrate PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    BUILD_RPATH "/home/pasc/.local/usr/lib:/home/pasc/.local/usr/lib/x86_64-linux-gnu"
    INSTALL_RPATH "/home/pasc/.local/usr/lib:/home/pasc/.local/usr/lib/x86_64-linux-gnu"
)
