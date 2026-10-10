#include "cme/common.hpp"
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

    std::cout << "[PASS] smoke_test succeeded.\n";
    return 0;
}
