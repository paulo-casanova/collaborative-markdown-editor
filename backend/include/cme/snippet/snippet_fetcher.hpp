/**
 * @file snippet_fetcher.hpp
 * @brief Secure remote code snippet fetching engine with authentication and named endpoint templates.
 */

#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <optional>
#include "cme/common.hpp"
#include "cme/config/config.hpp"

namespace cme::snippet {

struct ResolvedSnippetRequest {
    std::string target_url;
    std::vector<std::string> curl_args;
    std::string host;
    std::string endpoint_name; // Empty if direct URL
};

struct SnippetFetchResult {
    bool success{false};
    std::string content;
    std::string error_message;
    int http_status{200}; // 200, 400, 403, 404, 502
};

struct CommandResult {
    int exit_code{-1};
    std::string stdout_output;
    std::string stderr_output;
};

class SnippetFetcher {
public:
    explicit SnippetFetcher(config::SnippetsConfig config);

    /**
     * @brief Resolves a snippet source (named endpoint like "mg/foo/bar" or direct "https://...").
     * Performs ${PATH} and ${ENV_VAR} substitution, verifies host against allowlist.
     */
    [[nodiscard]] Result<ResolvedSnippetRequest> resolve_source(
        const std::string& source,
        std::string* error_msg_out = nullptr
    ) const;

    /**
     * @brief Fetches snippet content using curl with configured parameters.
     */
    [[nodiscard]] SnippetFetchResult fetch(const std::string& source) const;

    /**
     * @brief Lists configured endpoint names (e.g. ["mg", "gh"]).
     */
    [[nodiscard]] std::vector<std::string> list_endpoint_names() const;

    /**
     * @brief Lists allowed hosts.
     */
    [[nodiscard]] std::vector<std::string> list_allowed_hosts() const;

    /**
     * @brief Checks if a given hostname is permitted for snippet fetching.
     */
    [[nodiscard]] bool is_host_allowed(const std::string& host) const;

    /**
     * @brief Tokenizes a curl argument string respecting single and double quotes.
     */
    static std::vector<std::string> tokenize_args(const std::string& arg_str);

    /**
     * @brief Extracts lowercase hostname from an HTTP or HTTPS URL.
     */
    static std::string extract_host_from_url(const std::string& url);

    /**
     * @brief Substitutes ${VAR_NAME} placeholders with environment variables.
     */
    static Result<std::string> substitute_env_vars(
        const std::string& input,
        std::string* missing_var_out = nullptr
    );

    /**
     * @brief Executes curl safely via POSIX fork + execvp (no shell invocation).
     */
    static CommandResult execute_curl(
        const std::vector<std::string>& curl_args,
        const std::string& target_url,
        int timeout_seconds = 10
    );

private:
    config::SnippetsConfig config_;
    std::unordered_set<std::string> allowed_hosts_set_;
};

} // namespace cme::snippet
