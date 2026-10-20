cmake_minimum_required(VERSION 3.28)

project(CollaborativeMarkdownEditor
    VERSION 0.1.0
    DESCRIPTION "High-performance collaborative markdown editor and storage platform"
    LANGUAGES CXX C
)

# Allow subprojects (like yaml-cpp) with older cmake_minimum_required versions
set(CMAKE_POLICY_VERSION_MINIMUM 3.5 CACHE STRING "" FORCE)

# Enforce strict C++23 standard
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Export compile commands for language servers (clangd, etc.)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Default to Release if no build type specified
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    message(STATUS "Defaulting CMAKE_BUILD_TYPE to Release")
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Choose build type" FORCE)
endif()

# External & Third-Party Dependencies
list(PREPEND CMAKE_PREFIX_PATH "$ENV{HOME}/.local/usr")
find_package(OpenSSL REQUIRED)
find_package(ZLIB REQUIRED)
find_package(PostgreSQL REQUIRED)
find_package(PkgConfig REQUIRED)

include(cmake/Dependencies.cmake)

# Global runtime shared library lookup paths (RPATH)
get_filename_component(YRS_LIB_DIR "${YRS_LIB}" DIRECTORY)
set(CMAKE_BUILD_RPATH
    "${CMAKE_BINARY_DIR}/lib"
    "${YRS_LIB_DIR}"
    "$ENV{HOME}/.local/usr/lib"
    "$ENV{HOME}/.local/usr/lib/x86_64-linux-gnu"
)
set(CMAKE_INSTALL_RPATH
    "${CMAKE_INSTALL_PREFIX}/lib"
    "/usr/local/lib"
    "$ENV{HOME}/.local/usr/lib"
    "$ENV{HOME}/.local/usr/lib/x86_64-linux-gnu"
)

# Compiler warning flags for CME targets
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    add_compile_options(
        -Wall
        -Wextra
        -Wpedantic
        -Wconversion
        -Wsign-conversion
        -Wcast-qual
        -Wformat=2
        -Wundef
        -Werror=return-type
    )
endif()

# Enable Testing & CTest
include(CTest)
enable_testing()

# Module subdirectories
add_subdirectory(backend)

if(BUILD_TESTING)
    add_subdirectory(tests)

    # Convenience custom target 'check' to execute test suite
    add_custom_target(check
        COMMAND ${CMAKE_CTEST_COMMAND} --output-on-failure
        WORKING_DIRECTORY ${CMAKE_BINARY_DIR}
        COMMENT "Running test suite via ctest..."
    )
endif()
