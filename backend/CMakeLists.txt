# ==============================================================================
# CME Core Backend Library & Executables
# ==============================================================================

find_library(CRYPT_LIB crypt REQUIRED)


add_library(cme_core
    src/version.cpp
    src/config/config.cpp
    src/db/connection_pool.cpp
    src/db/migration_runner.cpp
    src/db/permission_engine.cpp
    src/storage/posix_storage_backend.cpp
    src/storage/storage_backend.cpp
    src/auth/crypto_utils.cpp
    src/auth/admin_provider.cpp
    src/auth/session_manager.cpp
    src/auth/auth_provider.cpp
    src/document/document_service.cpp
    src/document/integrity_verifier.cpp
    src/renderer/markdown_renderer.cpp
    src/admin/admin_service.cpp
    src/collab/crdt_doc.cpp
    src/collab/document_room.cpp
    src/collab/room_manager.cpp
    src/collab/persistence_worker.cpp
    src/review/review_service.cpp
    src/snippet/snippet_fetcher.cpp
    src/server/server.cpp
)

target_include_directories(cme_core
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<BUILD_INTERFACE:${YRS_INCLUDE_DIR}>
        $<BUILD_INTERFACE:${UWEBSOCKETS_INCLUDE_DIR}>
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
        pqxx
        PostgreSQL::PostgreSQL
        yaml-cpp
        uSockets
        OpenSSL::SSL
        OpenSSL::Crypto
        ZLIB::ZLIB
        ${CRYPT_LIB}
        ${YRS_LIB}
        md4c
        nlohmann_json::nlohmann_json
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

# CME Admin CLI Executable
add_executable(cme-admin
    src/admin_main.cpp
)

target_link_libraries(cme-admin
    PRIVATE
        cme_core
)

target_compile_features(cme-admin PRIVATE cxx_std_23)

set_target_properties(cme-server cme-migrate cme-admin PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)

