/**
 * @file version.hpp
 * @brief Version information and banner formatting for the CME platform.
 */

#pragma once

#include <string>
#include <string_view>

namespace cme {

/**
 * @struct Version
 * @brief Semantic version components of the compiled application.
 */
struct Version {
    int major{0};                 ///< Major version number.
    int minor{0};                 ///< Minor version number.
    int patch{0};                 ///< Patch version number.
    std::string_view string{"0.0.0"}; ///< Formatted version string (e.g., "0.1.0").
};

/**
 * @brief Retrieves the compiled semantic version struct.
 * @return Version struct populated with CMake build version constants.
 */
[[nodiscard]] Version get_version() noexcept;

/**
 * @brief Generates a formatted ASCII startup banner with version details.
 * @return Formatted banner string.
 */
[[nodiscard]] std::string format_version_banner() noexcept;

} // namespace cme
