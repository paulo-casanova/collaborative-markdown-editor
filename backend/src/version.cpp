#include "cme/version.hpp"
#include <format>

#ifndef CME_VERSION_MAJOR
#define CME_VERSION_MAJOR 0
#endif

#ifndef CME_VERSION_MINOR
#define CME_VERSION_MINOR 1
#endif

#ifndef CME_VERSION_PATCH
#define CME_VERSION_PATCH 0
#endif

#ifndef CME_VERSION_STRING
#define CME_VERSION_STRING "0.1.0"
#endif

namespace cme {

Version get_version() noexcept {
    return Version{
        .major = CME_VERSION_MAJOR,
        .minor = CME_VERSION_MINOR,
        .patch = CME_VERSION_PATCH,
        .string = CME_VERSION_STRING
    };
}

std::string format_version_banner() noexcept {
    return std::format("Collaborative Markdown Editor (CME) v{}", CME_VERSION_STRING);
}

} // namespace cme
