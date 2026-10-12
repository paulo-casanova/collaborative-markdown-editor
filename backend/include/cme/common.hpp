/**
 * @file common.hpp
 * @brief Common error taxonomies and monadic result wrappers for CME.
 */

#pragma once

#include <string_view>
#include <expected>
#include <cstdint>

namespace cme {

/**
 * @enum ErrorCode
 * @brief High-level error classification across storage, database, and network domains.
 */
enum class ErrorCode : uint32_t {
    Success = 0,        ///< Operation completed successfully.
    NotFound,           ///< Target resource or file was not found.
    PermissionDenied,   ///< Operation refused due to insufficient permissions.
    AlreadyExists,      ///< Resource or file already exists.
    InvalidArgument,    ///< Provided argument or parameter is invalid.
    IoError,            ///< Filesystem or OS I/O failure.
    DatabaseError,      ///< PostgreSQL query, connection, or transaction failure.
    InternalError       ///< Unhandled internal application error.
};

/**
 * @brief Converts an ErrorCode value to its human-readable string representation.
 * @param code The error code to convert.
 * @return String view of the error name.
 */
[[nodiscard]] constexpr std::string_view to_string(ErrorCode code) noexcept {
    switch (code) {
        case ErrorCode::Success: return "Success";
        case ErrorCode::NotFound: return "Not Found";
        case ErrorCode::PermissionDenied: return "Permission Denied";
        case ErrorCode::AlreadyExists: return "Already Exists";
        case ErrorCode::InvalidArgument: return "Invalid Argument";
        case ErrorCode::IoError: return "I/O Error";
        case ErrorCode::DatabaseError: return "Database Error";
        case ErrorCode::InternalError: return "Internal Error";
    }
    return "Unknown Error";
}

/**
 * @brief Primary monadic return type for CME operations using C++23 std::expected.
 * @tparam T Type of the expected success value.
 */
template <typename T>
using Result = std::expected<T, ErrorCode>;

/**
 * @brief Validates whether a given string is a valid standard 36-character UUIDv4 (8-4-4-4-12 hex).
 * @param str The string view to validate.
 * @return True if strictly formatted as a valid canonical UUID, false otherwise.
 */
[[nodiscard]] constexpr bool is_valid_uuid(std::string_view str) noexcept {
    if (str.size() != 36) return false;
    for (size_t i = 0; i < 36; ++i) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (str[i] != '-') return false;
        } else {
            char c = str[i];
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
                return false;
            }
        }
    }
    return true;
}

} // namespace cme
