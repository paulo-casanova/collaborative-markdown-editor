#include "cme/server/server.hpp"
#include "cme/document/integrity_verifier.hpp"
#include "cme/version.hpp"
#include <iostream>
#include <csignal>
#include <memory>
#include <atomic>
#include <thread>

namespace {
std::shared_ptr<cme::server::Server> g_server;
std::atomic<bool> g_shutdown_requested{false};
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

    // Mask SIGINT and SIGTERM before creating any threads so that all spawned
    // threads inherit this mask and asynchronous signal delivery is avoided.
    sigset_t sigset;
    sigemptyset(&sigset);
    sigaddset(&sigset, SIGINT);
    sigaddset(&sigset, SIGTERM);
    pthread_sigmask(SIG_BLOCK, &sigset, nullptr);

    g_server = std::make_shared<cme::server::Server>(cfg);

    // Dedicated signal-handling thread that synchronously waits for signals
    // outside of an async signal handler context, ensuring full async-signal-safety.
    std::thread signal_thread([&sigset]() {
        while (!g_shutdown_requested.load()) {
            struct timespec ts{ .tv_sec = 0, .tv_nsec = 100000000 }; // 100ms
            siginfo_t si;
            int sig = sigtimedwait(&sigset, &si, &ts);
            if (sig > 0) {
                std::cout << "\n[INFO] Caught shutdown signal (" << sig << "), stopping server...\n";
                if (g_server) {
                    g_server->stop();
                }
                break;
            }
        }
    });

    auto run_res = g_server->start();

    g_shutdown_requested = true;
    if (signal_thread.joinable()) {
        signal_thread.join();
    }

    if (!run_res.has_value()) {
        std::cerr << "[FATAL] Server encountered an error on startup: "
                  << cme::to_string(run_res.error()) << "\n";
        return 1;
    }

    std::cout << "[INFO] Server stopped gracefully.\n";
    return 0;
}
