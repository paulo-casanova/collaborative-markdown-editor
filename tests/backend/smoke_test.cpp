#include "cme/common.hpp"
#include "cme/config/config.hpp"
#include <cassert>
#include <iostream>
#include <string_view>

int main() {
    std::cout << "[TEST] Running smoke test on C++23 features and common types...\n";

    // 1. Verify ErrorCode string conversions
    assert(cme::to_string(cme::ErrorCode::Success) == "Success");
    assert(cme::to_string(cme::ErrorCode::NotFound) == "Not Found");
    assert(cme::to_string(cme::ErrorCode::PermissionDenied) == "Permission Denied");

    // 2. Verify C++23 std::expected / cme::Result<T>
    cme::Result<int> ok_res = 100;
    assert(ok_res.has_value());
    assert(*ok_res == 100);

    cme::Result<int> err_res = std::unexpected(cme::ErrorCode::NotFound);
    assert(!err_res.has_value());
    assert(err_res.error() == cme::ErrorCode::NotFound);

    // 3. Verify std::expected transform / and_then (monadic operations in C++23)
    auto mapped = ok_res.transform([](int val) { return val * 2; });
    assert(mapped.has_value());
    assert(*mapped == 200);

    // 4. Verify ServerConfig keepalive_timeout_seconds default and overrides
    {
        char arg0[] = "cme-server";
        char* default_argv[] = {arg0};
        auto default_cfg = cme::config::AppConfig::load(1, default_argv);
        assert(default_cfg.has_value());
        assert(default_cfg->server.keepalive_timeout_seconds == 120);

        char arg1[] = "--keepalive-timeout";
        char arg2[] = "45";
        char* cli_argv[] = {arg0, arg1, arg2};
        auto cli_cfg = cme::config::AppConfig::load(3, cli_argv);
        assert(cli_cfg.has_value());
        assert(cli_cfg->server.keepalive_timeout_seconds == 45);

        setenv("CME_SERVER_KEEPALIVE_TIMEOUT_SECONDS", "60", 1);
        auto env_cfg = cme::config::AppConfig::load(1, default_argv);
        assert(env_cfg.has_value());
        assert(env_cfg->server.keepalive_timeout_seconds == 60);
        unsetenv("CME_SERVER_KEEPALIVE_TIMEOUT_SECONDS");
    }

    std::cout << "[PASS] smoke_test succeeded.\n";
    return 0;
}
