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

} // namespace cme
