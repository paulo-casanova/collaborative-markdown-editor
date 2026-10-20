/**
 * @file snippet_fetcher_test.cpp
 * @brief Unit tests for SnippetFetcher (SSRF protection, named endpoints, env substitution, curl args).
 */

#include "cme/snippet/snippet_fetcher.hpp"
#include <cassert>
#include <iostream>
#include <cstdlib>

using namespace cme;
using namespace cme::snippet;

void test_tokenize_args() {
    auto args = SnippetFetcher::tokenize_args("-H 'Authorization: Bearer token123' -H \"Accept: text/plain\" -u user:pass");
    assert(args.size() == 6);
    assert(args[0] == "-H");
    assert(args[1] == "Authorization: Bearer token123");
    assert(args[2] == "-H");
    assert(args[3] == "Accept: text/plain");
    assert(args[4] == "-u");
    assert(args[5] == "user:pass");
    std::cout << "[PASS] test_tokenize_args\n";
}

void test_extract_host() {
    assert(SnippetFetcher::extract_host_from_url("https://github.com/foo/bar") == "github.com");
    assert(SnippetFetcher::extract_host_from_url("http://GITLAB.COM:8080/api/v4") == "gitlab.com");
    assert(SnippetFetcher::extract_host_from_url("https://user:pass@raw.githubusercontent.com/file") == "raw.githubusercontent.com");
    assert(SnippetFetcher::extract_host_from_url("invalid_url") == "");
    std::cout << "[PASS] test_extract_host\n";
}

void test_env_substitution() {
    setenv("CME_TEST_KEY", "secret_value_42", 1);
    std::string err;
    auto res1 = SnippetFetcher::substitute_env_vars("https://api.com/?key=${CME_TEST_KEY}&type=fast", &err);
    assert(res1.has_value());
    assert(res1.value() == "https://api.com/?key=secret_value_42&type=fast");

    auto res2 = SnippetFetcher::substitute_env_vars("https://api.com/?key=${NON_EXISTENT_VAR_xyz}", &err);
    assert(!res2.has_value());
    assert(err == "NON_EXISTENT_VAR_xyz");
    std::cout << "[PASS] test_env_substitution\n";
}

void test_host_allowlist_and_endpoints() {
    setenv("CME_MY_TOKEN", "tok_xyz_999", 1);

    config::SnippetsConfig cfg;
    cfg.allowed_hosts = {"github.com", "*.trusted.org"};
    cfg.default_curl_args = "-H 'X-Client: CME'";
    cfg.endpoints["mg"] = config::SnippetEndpointConfig{
        .url = "https://www.mygit.com/${PATH}?token=${CME_MY_TOKEN}",
        .curl_args = "-H 'Accept: text/plain'"
    };
    cfg.endpoints["gh"] = config::SnippetEndpointConfig{
        .url = "https://raw.githubusercontent.com/org/${PATH}",
        .curl_args = ""
    };

    SnippetFetcher fetcher(cfg);

    // Named endpoint target hosts should be automatically allowed
    assert(fetcher.is_host_allowed("www.mygit.com"));
    assert(fetcher.is_host_allowed("raw.githubusercontent.com"));
    assert(fetcher.is_host_allowed("github.com"));
    assert(fetcher.is_host_allowed("sub.trusted.org"));
    assert(!fetcher.is_host_allowed("evil-hacker.com"));
    assert(!fetcher.is_host_allowed("nottrusted.org"));

    // Resolve named endpoint mg/repo/main.cpp
    std::string err;
    auto r1 = fetcher.resolve_source("mg/repo/main.cpp", &err);
    assert(r1.has_value());
    assert(r1.value().target_url == "https://www.mygit.com/repo/main.cpp?token=tok_xyz_999");
    assert(r1.value().host == "www.mygit.com");
    assert(r1.value().endpoint_name == "mg");
    // args should include default and endpoint curl args
    assert(r1.value().curl_args.size() == 4);
    assert(r1.value().curl_args[0] == "-H");
    assert(r1.value().curl_args[1] == "X-Client: CME");
    assert(r1.value().curl_args[2] == "-H");
    assert(r1.value().curl_args[3] == "Accept: text/plain");

    // Resolve named endpoint with query params in path
    auto r2 = fetcher.resolve_source("mg/repo/main.cpp?ref=v1.0", &err);
    assert(r2.has_value());
    assert(r2.value().target_url == "https://www.mygit.com/repo/main.cpp?ref=v1.0&token=tok_xyz_999");

    // Disallowed direct URL should be blocked
    auto r3 = fetcher.resolve_source("https://evil-hacker.com/malicious.cpp", &err);
    assert(!r3.has_value());
    assert(err.find("not in the allowed hosts list") != std::string::npos);

    // Allowed direct URL
    auto r4 = fetcher.resolve_source("https://github.com/torvalds/linux/blob/master/README", &err);
    assert(r4.has_value());
    assert(r4.value().target_url == "https://github.com/torvalds/linux/blob/master/README");

    std::cout << "[PASS] test_host_allowlist_and_endpoints\n";
}

void test_missing_env_var() {
    config::SnippetsConfig cfg;
    cfg.endpoints["gh"] = config::SnippetEndpointConfig{
        .url = "https://github.com/${PATH}?token=${UNDEFINED_TOKEN_VAR_ABC}",
        .curl_args = ""
    };

    SnippetFetcher fetcher(cfg);
    std::string err;
    auto res = fetcher.resolve_source("gh/myrepo", &err);
    assert(!res.has_value());
    assert(err.find("UNDEFINED_TOKEN_VAR_ABC") != std::string::npos);
    std::cout << "[PASS] test_missing_env_var\n";
}

void test_paths_with_spaces_and_parentheses() {
    config::SnippetsConfig cfg;
    cfg.allowed_hosts = {"raw.githubusercontent.com", "mygit.com"};
    cfg.endpoints["mg"] = config::SnippetEndpointConfig{
        .url = "https://mygit.com/${PATH}",
        .curl_args = ""
    };

    SnippetFetcher fetcher(cfg);
    std::string err;

    // Named endpoint with spaces and parentheses: "Foo (TODO).md"
    auto r1 = fetcher.resolve_source("mg/docs/Foo (TODO).md", &err);
    assert(r1.has_value());
    assert(r1.value().target_url == "https://mygit.com/docs/Foo%20%28TODO%29.md");

    // Named endpoint with spaces, parens, and query string
    auto r2 = fetcher.resolve_source("mg/src/Bar (Final) Version.cpp?ref=v2.0&tag=my tag", &err);
    assert(r2.has_value());
    assert(r2.value().target_url == "https://mygit.com/src/Bar%20%28Final%29%20Version.cpp?ref=v2.0&tag=my%20tag");

    // Direct URL with spaces and parentheses
    auto r3 = fetcher.resolve_source("https://raw.githubusercontent.com/user/repo/main/Foo (TODO).md", &err);
    assert(r3.has_value());
    assert(r3.value().target_url == "https://raw.githubusercontent.com/user/repo/main/Foo%20%28TODO%29.md");

    std::cout << "[PASS] test_paths_with_spaces_and_parentheses\n";
}

int main() {
    std::cout << "Starting Snippet Fetcher Unit Tests...\n";
    test_tokenize_args();
    test_extract_host();
    test_env_substitution();
    test_host_allowlist_and_endpoints();
    test_missing_env_var();
    test_paths_with_spaces_and_parentheses();
    std::cout << "All Snippet Fetcher Unit Tests PASSED!\n";
    return 0;
}
