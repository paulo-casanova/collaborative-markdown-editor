#include "cme/version.hpp"
#include <cassert>
#include <iostream>

int main() {
    auto version = cme::get_version();
    std::cout << "[TEST] Checking CME Version components...\n";
    std::cout << "  Major: " << version.major << "\n";
    std::cout << "  Minor: " << version.minor << "\n";
    std::cout << "  Patch: " << version.patch << "\n";
    std::cout << "  String: " << version.string << "\n";

    assert(version.major == 0);
    assert(version.minor == 1);
    assert(version.patch == 0);
    assert(!version.string.empty());

    auto banner = cme::format_version_banner();
    std::cout << "[TEST] Checking Banner: " << banner << "\n";
    assert(banner.find("0.1.0") != std::string::npos);
    assert(banner.find("Collaborative Markdown Editor") != std::string::npos);

    std::cout << "[PASS] version_test succeeded.\n";
    return 0;
}
