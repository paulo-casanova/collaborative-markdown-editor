#pragma once

#include <string_view>
#include <expected>
#include <cstdint>

namespace cme {

enum class ErrorCode : uint32_t {
    Success = 0,
    NotFound,
    PermissionDenied,
    AlreadyExists,
    InvalidArgument,
    IoError,
    DatabaseError,
    InternalError
};

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

template <typename T>
using Result = std::expected<T, ErrorCode>;

} // namespace cme
