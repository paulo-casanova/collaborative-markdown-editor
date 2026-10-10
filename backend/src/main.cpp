#include "cme/version.hpp"
#include <iostream>

int main(int argc, char* argv[]) {
    (void)argc;
    (void)argv;
    std::cout << cme::format_version_banner() << "\n";
    std::cout << "Native C++23 Collaborative Markdown Platform Daemon\n";
    return 0;
}
