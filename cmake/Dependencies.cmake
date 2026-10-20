# ==============================================================================
# CME Third-Party Dependencies
# Resolves dependencies in the following priority:
# 1. User-specified paths/options (e.g., -D<DEP>_ROOT=... or -D<DEP>_SOURCE_DIR=...)
# 2. System installed packages/libraries (find_package / find_library)
# 3. Automatic build-time download via FetchContent
# ==============================================================================

include(FetchContent)

if(POLICY CMP0169)
    cmake_policy(SET CMP0169 OLD)
endif()

# ------------------------------------------------------------------------------
# 1. yaml-cpp
# ------------------------------------------------------------------------------
if(YAML_CPP_ROOT)
    set(YAML_CPP_SOURCE_DIR "${YAML_CPP_ROOT}")
endif()
if(YAML_CPP_SOURCE_DIR)
    set(FETCHCONTENT_SOURCE_DIR_YAML-CPP "${YAML_CPP_SOURCE_DIR}" CACHE PATH "User-specified yaml-cpp path" FORCE)
endif()

if(YAML_CPP_LIB AND YAML_CPP_INCLUDE_DIR)
    if(NOT TARGET yaml-cpp)
        add_library(yaml-cpp UNKNOWN IMPORTED GLOBAL)
        set_target_properties(yaml-cpp PROPERTIES
            IMPORTED_LOCATION "${YAML_CPP_LIB}"
            INTERFACE_INCLUDE_DIRECTORIES "${YAML_CPP_INCLUDE_DIR}"
        )
    endif()
else()
    find_package(yaml-cpp QUIET)
    if(NOT TARGET yaml-cpp AND NOT TARGET yaml-cpp::yaml-cpp)
        set(YAML_CPP_BUILD_TESTS OFF CACHE BOOL "" FORCE)
        set(YAML_CPP_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
        set(YAML_BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
        FetchContent_Declare(
            yaml-cpp
            GIT_REPOSITORY https://github.com/jbeder/yaml-cpp.git
            GIT_TAG 0.8.0
            GIT_SHALLOW TRUE
            GIT_SUBMODULES ""
            SYSTEM
        )
        FetchContent_MakeAvailable(yaml-cpp)
    endif()
endif()

# ------------------------------------------------------------------------------
# 2. libpqxx
# ------------------------------------------------------------------------------
if(LIBPQXX_ROOT)
    set(LIBPQXX_SOURCE_DIR "${LIBPQXX_ROOT}")
endif()
if(LIBPQXX_SOURCE_DIR)
    set(FETCHCONTENT_SOURCE_DIR_LIBPQXX "${LIBPQXX_SOURCE_DIR}" CACHE PATH "User-specified libpqxx path" FORCE)
endif()

if(LIBPQXX_LIB AND LIBPQXX_INCLUDE_DIR)
    if(NOT TARGET pqxx)
        add_library(pqxx UNKNOWN IMPORTED GLOBAL)
        set_target_properties(pqxx PROPERTIES
            IMPORTED_LOCATION "${LIBPQXX_LIB}"
            INTERFACE_INCLUDE_DIRECTORIES "${LIBPQXX_INCLUDE_DIR}"
        )
    endif()
else()
    find_package(libpqxx QUIET)
    if(NOT TARGET pqxx AND NOT TARGET pqxx::pqxx)
        set(SKIP_BUILD_TEST ON CACHE BOOL "" FORCE)
        FetchContent_Declare(
            libpqxx
            GIT_REPOSITORY https://github.com/jtv/libpqxx.git
            GIT_TAG 7.10.7
            GIT_SHALLOW TRUE
            GIT_SUBMODULES ""
            SYSTEM
        )
        FetchContent_MakeAvailable(libpqxx)
    endif()
endif()

# ------------------------------------------------------------------------------
# 3. nlohmann_json
# ------------------------------------------------------------------------------
if(NLOHMANN_JSON_ROOT)
    if(EXISTS "${NLOHMANN_JSON_ROOT}/include")
        set(NLOHMANN_JSON_INCLUDE_DIR "${NLOHMANN_JSON_ROOT}/include")
    elseif(EXISTS "${NLOHMANN_JSON_ROOT}/single_include")
        set(NLOHMANN_JSON_INCLUDE_DIR "${NLOHMANN_JSON_ROOT}/single_include")
    else()
        set(NLOHMANN_JSON_SOURCE_DIR "${NLOHMANN_JSON_ROOT}")
    endif()
endif()
if(NLOHMANN_JSON_SOURCE_DIR)
    set(FETCHCONTENT_SOURCE_DIR_NLOHMANN_JSON "${NLOHMANN_JSON_SOURCE_DIR}" CACHE PATH "User-specified nlohmann_json path" FORCE)
endif()

if(NLOHMANN_JSON_INCLUDE_DIR)
    if(NOT TARGET nlohmann_json::nlohmann_json)
        add_library(nlohmann_json_interface INTERFACE)
        target_include_directories(nlohmann_json_interface INTERFACE "${NLOHMANN_JSON_INCLUDE_DIR}")
        add_library(nlohmann_json::nlohmann_json ALIAS nlohmann_json_interface)
    endif()
else()
    find_package(nlohmann_json 3.11 QUIET)
    if(NOT nlohmann_json_FOUND AND NOT TARGET nlohmann_json::nlohmann_json)
        set(JSON_BuildTests OFF CACHE BOOL "" FORCE)
        set(JSON_Install OFF CACHE BOOL "" FORCE)
        FetchContent_Declare(
            nlohmann_json
            GIT_REPOSITORY https://github.com/nlohmann/json.git
            GIT_TAG v3.11.3
            GIT_SHALLOW TRUE
            GIT_SUBMODULES ""
            SYSTEM
        )
        FetchContent_MakeAvailable(nlohmann_json)
    endif()
endif()

# ------------------------------------------------------------------------------
# 4. md4c
# ------------------------------------------------------------------------------
if(MD4C_ROOT)
    if(EXISTS "${MD4C_ROOT}/lib")
        set(MD4C_LIB_DIR "${MD4C_ROOT}/lib")
    endif()
    if(EXISTS "${MD4C_ROOT}/include")
        set(MD4C_INCLUDE_DIR "${MD4C_ROOT}/include")
    endif()
    if(EXISTS "${MD4C_ROOT}/CMakeLists.txt")
        set(MD4C_SOURCE_DIR "${MD4C_ROOT}")
    endif()
endif()
if(MD4C_SOURCE_DIR)
    set(FETCHCONTENT_SOURCE_DIR_MD4C "${MD4C_SOURCE_DIR}" CACHE PATH "User-specified md4c path" FORCE)
endif()

if(NOT TARGET md4c AND NOT TARGET md4c::md4c)
    if(NOT MD4C_LIB)
        find_library(MD4C_LIB NAMES md4c PATHS ${MD4C_LIB_DIR} "$ENV{HOME}/.local/usr/lib" /usr/local/lib /usr/lib)
    endif()
    if(NOT MD4C_INCLUDE_DIR)
        find_path(MD4C_INCLUDE_DIR NAMES md4c.h PATHS ${MD4C_INCLUDE_DIR} "$ENV{HOME}/.local/usr/include" /usr/local/include /usr/include)
    endif()

    if(MD4C_LIB AND MD4C_INCLUDE_DIR)
        add_library(md4c UNKNOWN IMPORTED GLOBAL)
        set_target_properties(md4c PROPERTIES
            IMPORTED_LOCATION "${MD4C_LIB}"
            INTERFACE_INCLUDE_DIRECTORIES "${MD4C_INCLUDE_DIR}"
        )
    else()
        find_package(md4c CONFIG QUIET)
        if(NOT TARGET md4c AND NOT TARGET md4c::md4c)
            set(BUILD_MD2HTML_EXECUTABLE OFF CACHE BOOL "" FORCE)
            set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
            FetchContent_Declare(
                md4c
                GIT_REPOSITORY https://github.com/mity/md4c.git
                GIT_TAG release-0.5.2
                GIT_SHALLOW TRUE
                GIT_SUBMODULES ""
                SYSTEM
            )
            FetchContent_MakeAvailable(md4c)
            if(TARGET md4c)
                target_include_directories(md4c PUBLIC $<BUILD_INTERFACE:${md4c_SOURCE_DIR}/src>)
                if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
                    target_compile_options(md4c PRIVATE -w)
                endif()
            endif()
        elseif(TARGET md4c::md4c AND NOT TARGET md4c)
            add_library(md4c ALIAS md4c::md4c)
        endif()
    endif()
elseif(TARGET md4c::md4c AND NOT TARGET md4c)
    add_library(md4c ALIAS md4c::md4c)
endif()

# ------------------------------------------------------------------------------
# 5. uSockets
# ------------------------------------------------------------------------------
if(USOCKETS_ROOT)
    set(USOCKETS_SOURCE_DIR "${USOCKETS_ROOT}")
    if(EXISTS "${USOCKETS_ROOT}/lib")
        set(USOCKETS_LIB_DIR "${USOCKETS_ROOT}/lib")
    endif()
    if(EXISTS "${USOCKETS_ROOT}/include")
        set(USOCKETS_INCLUDE_DIR "${USOCKETS_ROOT}/include")
    endif()
endif()
if(USOCKETS_SOURCE_DIR AND EXISTS "${USOCKETS_SOURCE_DIR}/src/bsd.c")
    set(FETCHCONTENT_SOURCE_DIR_USOCKETS "${USOCKETS_SOURCE_DIR}" CACHE PATH "User-specified uSockets path" FORCE)
endif()

if(NOT TARGET uSockets)
    if(NOT USOCKETS_LIB AND USOCKETS_LIB_DIR)
        find_library(USOCKETS_LIB NAMES uSockets usockets PATHS ${USOCKETS_LIB_DIR} NO_DEFAULT_PATH)
    endif()
    if(NOT USOCKETS_INCLUDE_DIR AND USOCKETS_LIB_DIR)
        find_path(USOCKETS_INCLUDE_DIR NAMES libusockets.h PATHS "${USOCKETS_ROOT}/include" "${USOCKETS_ROOT}/src" NO_DEFAULT_PATH)
    endif()

    if(USOCKETS_LIB AND USOCKETS_INCLUDE_DIR)
        add_library(uSockets UNKNOWN IMPORTED GLOBAL)
        set_target_properties(uSockets PROPERTIES
            IMPORTED_LOCATION "${USOCKETS_LIB}"
            INTERFACE_INCLUDE_DIRECTORIES "${USOCKETS_INCLUDE_DIR}"
        )
        target_link_libraries(uSockets INTERFACE OpenSSL::SSL OpenSSL::Crypto)
    else()
        FetchContent_Declare(
            usockets
            GIT_REPOSITORY https://github.com/uNetworking/uSockets.git
            GIT_TAG 86097c490263ab662d62e8e7b541390bdec7d149
            GIT_SUBMODULES ""
            SYSTEM
        )
        FetchContent_GetProperties(usockets)
        if(NOT usockets_POPULATED)
            FetchContent_Populate(usockets)
        endif()

        add_library(uSockets STATIC
            ${usockets_SOURCE_DIR}/src/bsd.c
            ${usockets_SOURCE_DIR}/src/context.c
            ${usockets_SOURCE_DIR}/src/loop.c
            ${usockets_SOURCE_DIR}/src/socket.c
            ${usockets_SOURCE_DIR}/src/udp.c
            ${usockets_SOURCE_DIR}/src/eventing/epoll_kqueue.c
            ${usockets_SOURCE_DIR}/src/crypto/openssl.c
            ${usockets_SOURCE_DIR}/src/crypto/sni_tree.cpp
        )
        target_include_directories(uSockets
            PUBLIC
                $<BUILD_INTERFACE:${usockets_SOURCE_DIR}/src>
        )
        target_compile_definitions(uSockets PUBLIC LIBUS_USE_OPENSSL)
        if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
            target_compile_options(uSockets PRIVATE -w)
        endif()
        target_link_libraries(uSockets PUBLIC OpenSSL::SSL OpenSSL::Crypto)
    endif()
endif()

# ------------------------------------------------------------------------------
# 6. uWebSockets
# ------------------------------------------------------------------------------
if(UWEBSOCKETS_ROOT)
    set(UWEBSOCKETS_SOURCE_DIR "${UWEBSOCKETS_ROOT}")
endif()
if(UWEBSOCKETS_SOURCE_DIR AND EXISTS "${UWEBSOCKETS_SOURCE_DIR}/src/App.h")
    set(FETCHCONTENT_SOURCE_DIR_UWEBSOCKETS "${UWEBSOCKETS_SOURCE_DIR}" CACHE PATH "User-specified uWebSockets path" FORCE)
endif()

if(NOT UWEBSOCKETS_INCLUDE_DIR)
    find_path(UWEBSOCKETS_INCLUDE_DIR NAMES uWebSockets/App.h PATHS "$ENV{HOME}/.local/usr/include" /usr/local/include /usr/include)
endif()

if(NOT UWEBSOCKETS_INCLUDE_DIR)
    FetchContent_Declare(
        uwebsockets
        GIT_REPOSITORY https://github.com/uNetworking/uWebSockets.git
        GIT_TAG 38cf9d811598aa3ce5134eba7d29e21f2db259ae
        GIT_SUBMODULES ""
        SYSTEM
    )
    FetchContent_GetProperties(uwebsockets)
    if(NOT uwebsockets_POPULATED)
        FetchContent_Populate(uwebsockets)
    endif()

    file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/include")
    if(NOT EXISTS "${CMAKE_BINARY_DIR}/include/uWebSockets")
        if(CMAKE_HOST_UNIX)
            file(CREATE_LINK "${uwebsockets_SOURCE_DIR}/src" "${CMAKE_BINARY_DIR}/include/uWebSockets" SYMBOLIC)
        else()
            file(COPY "${uwebsockets_SOURCE_DIR}/src/" DESTINATION "${CMAKE_BINARY_DIR}/include/uWebSockets")
        endif()
    endif()
    set(UWEBSOCKETS_INCLUDE_DIR "${CMAKE_BINARY_DIR}/include" CACHE PATH "uWebSockets include dir" FORCE)
endif()

# ------------------------------------------------------------------------------
# 7. yrs (yffi native Yjs CRDT C-FFI)
# ------------------------------------------------------------------------------
if(YRS_ROOT)
    set(YRS_LIB_DIR "${YRS_ROOT}/lib")
    set(YRS_INCLUDE_DIR "${YRS_ROOT}/include")
endif()

if(NOT YRS_LIB)
    find_library(YRS_LIB yrs PATHS ${YRS_LIB_DIR} "$ENV{HOME}/.local/usr/lib" /usr/local/lib /usr/lib)
endif()
if(NOT YRS_INCLUDE_DIR)
    find_path(YRS_INCLUDE_DIR libyrs.h PATHS ${YRS_INCLUDE_DIR} "$ENV{HOME}/.local/usr/include" /usr/local/include /usr/include)
endif()

if(NOT YRS_LIB OR NOT YRS_INCLUDE_DIR)
    if(CMAKE_SYSTEM_NAME STREQUAL "Linux" AND CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|AMD64")
        set(YRS_ARCH "x86_64-linux")
        set(YRS_ARCH_EXT "tar.xz")
    elseif(CMAKE_SYSTEM_NAME STREQUAL "Darwin")
        set(YRS_ARCH "aarch64-macos")
        set(YRS_ARCH_EXT "tar.xz")
    elseif(CMAKE_SYSTEM_NAME STREQUAL "Windows")
        set(YRS_ARCH "x86_64-windows")
        set(YRS_ARCH_EXT "zip")
    else()
        message(FATAL_ERROR "Could not automatically determine yffi prebuilt archive for platform ${CMAKE_SYSTEM_NAME}-${CMAKE_SYSTEM_PROCESSOR}. Please specify YRS_ROOT or YRS_LIB and YRS_INCLUDE_DIR.")
    endif()

    FetchContent_Declare(
        yrs_prebuilt
        URL "https://github.com/y-crdt/y-crdt/releases/download/v0.28.0/yffi-v0.28.0-${YRS_ARCH}.${YRS_ARCH_EXT}"
    )
    FetchContent_GetProperties(yrs_prebuilt)
    if(NOT yrs_prebuilt_POPULATED)
        FetchContent_Populate(yrs_prebuilt)
    endif()

    find_library(YRS_LIB yrs PATHS "${yrs_prebuilt_SOURCE_DIR}" "${yrs_prebuilt_SOURCE_DIR}/yffi-v0.28.0-${YRS_ARCH}" NO_DEFAULT_PATH)
    find_path(YRS_INCLUDE_DIR libyrs.h PATHS "${yrs_prebuilt_SOURCE_DIR}" "${yrs_prebuilt_SOURCE_DIR}/yffi-v0.28.0-${YRS_ARCH}" NO_DEFAULT_PATH)
endif()

if(NOT YRS_LIB OR NOT YRS_INCLUDE_DIR)
    message(FATAL_ERROR "Failed to locate or download libyrs library and headers.")
endif()

# Copy libyrs shared library to ${CMAKE_BINARY_DIR}/lib for runtime discovery
file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/lib")
get_filename_component(YRS_LIB_NAME "${YRS_LIB}" NAME)
get_filename_component(YRS_LIB_REALPATH "${YRS_LIB}" REALPATH)
if(NOT EXISTS "${CMAKE_BINARY_DIR}/lib/${YRS_LIB_NAME}")
    file(COPY "${YRS_LIB_REALPATH}" DESTINATION "${CMAKE_BINARY_DIR}/lib")
    if(NOT "${YRS_LIB_NAME}" STREQUAL "${YRS_LIB_REALPATH}")
        get_filename_component(YRS_REAL_NAME "${YRS_LIB_REALPATH}" NAME)
        if(NOT "${YRS_REAL_NAME}" STREQUAL "${YRS_LIB_NAME}")
            file(CREATE_LINK "${CMAKE_BINARY_DIR}/lib/${YRS_REAL_NAME}" "${CMAKE_BINARY_DIR}/lib/${YRS_LIB_NAME}" SYMBOLIC)
        endif()
    endif()
endif()

