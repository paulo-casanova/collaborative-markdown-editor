# ==============================================================================
# CME Core Backend Library & Executables
# ==============================================================================

set(ENV{PKG_CONFIG_PATH} "$ENV{HOME}/.local/usr/lib/pkgconfig:$ENV{PKG_CONFIG_PATH}")
pkg_check_modules(PQXX REQUIRED IMPORTED_TARGET libpqxx)
pkg_check_modules(PQ REQUIRED IMPORTED_TARGET libpq)
pkg_check_modules(YAML_CPP REQUIRED IMPORTED_TARGET yaml-cpp)

find_library(USOCKETS_LIB uSockets PATHS "$ENV{HOME}/.local/usr/lib" REQUIRED)
find_library(CRYPT_LIB crypt REQUIRED)

# md4c Markdown Parser (vendored C library)
add_library(md4c STATIC
    third_party/md4c/md4c.c
    third_party/md4c/entity.c
)
target_include_directories(md4c
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/third_party/md4c>
)
if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(md4c PRIVATE -w)
endif()

add_library(cme_core
    src/version.cpp
    src/config/config.cpp
    src/db/connection_pool.cpp
    src/db/migration_runner.cpp
    src/db/permission_engine.cpp
    src/storage/posix_storage_backend.cpp
    src/auth/crypto_utils.cpp
    src/auth/admin_provider.cpp
    src/auth/session_manager.cpp
    src/auth/auth_provider.cpp
    src/document/document_service.cpp
    src/renderer/markdown_renderer.cpp
    src/server/server.cpp
)

target_include_directories(cme_core
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
        "$ENV{HOME}/.local/usr/include"
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
        PkgConfig::YAML_CPP
        ${USOCKETS_LIB}
        OpenSSL::SSL
        OpenSSL::Crypto
        ZLIB::ZLIB
        ${CRYPT_LIB}
        md4c
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
