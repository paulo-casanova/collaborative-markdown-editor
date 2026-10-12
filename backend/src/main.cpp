#include "cme/server/server.hpp"
#include "cme/document/integrity_verifier.hpp"
#include "cme/version.hpp"
#include <iostream>
#include <csignal>
#include <memory>

namespace {
std::shared_ptr<cme::server::Server> g_server;

void signal_handler(int sig) {
    std::cout << "\n[INFO] Caught shutdown signal (" << sig << "), stopping server...\n";
    if (g_server) {
        g_server->stop();
    }
}
} // namespace

int main(int argc, char* argv[]) {
    std::cout << cme::format_version_banner() << "\n";

    auto cfg_res = cme::config::AppConfig::load(argc, argv);
    if (!cfg_res.has_value()) {
        std::cerr << "[FATAL] Failed to initialize configuration.\n";
        return 1;
    }

    const auto& cfg = *cfg_res;

    if (cfg.verify_integrity_only) {
        return cme::document::IntegrityVerifier::run(cfg);
    }

    g_server = std::make_shared<cme::server::Server>(cfg);

    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);

    auto run_res = g_server->start();
    if (!run_res.has_value()) {
        std::cerr << "[FATAL] Server encountered an error on startup: "
                  << cme::to_string(run_res.error()) << "\n";
        return 1;
    }

    std::cout << "[INFO] Server stopped gracefully.\n";
    return 0;
}
