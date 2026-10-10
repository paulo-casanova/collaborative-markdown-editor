#pragma once

#include <string>
#include <string_view>

namespace cme {

struct Version {
    int major{0};
    int minor{0};
    int patch{0};
    std::string_view string{"0.0.0"};
};

[[nodiscard]] Version get_version() noexcept;
[[nodiscard]] std::string format_version_banner() noexcept;

} // namespace cme
