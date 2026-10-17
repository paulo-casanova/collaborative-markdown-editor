/**
 * @file snippet_fetcher.cpp
 * @brief Implementation of secure remote code snippet fetching engine.
 */

#include "cme/snippet/snippet_fetcher.hpp"
#include <iostream>
#include <sstream>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <unistd.h>
#include <sys/wait.h>
#include <fcntl.h>

namespace cme::snippet {

SnippetFetcher::SnippetFetcher(config::SnippetsConfig config)
    : config_(std::move(config)) {
    // Populate allowed hosts set
    for (const auto& h : config_.allowed_hosts) {
        std::string lower = h;
        for (char& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        while (!lower.empty() && std::isspace(static_cast<unsigned char>(lower.front()))) lower.erase(lower.begin());
        while (!lower.empty() && std::isspace(static_cast<unsigned char>(lower.back()))) lower.pop_back();
        if (!lower.empty()) {
            allowed_hosts_set_.insert(lower);
        }
    }

    // Automatically allow target hosts from configured named endpoints
    for (const auto& [name, ep] : config_.endpoints) {
        std::string host = extract_host_from_url(ep.url);
        if (!host.empty()) {
            allowed_hosts_set_.insert(host);
        }
    }
}

std::vector<std::string> SnippetFetcher::list_endpoint_names() const {
    std::vector<std::string> names;
    names.reserve(config_.endpoints.size());
    for (const auto& [name, _] : config_.endpoints) {
        names.push_back(name);
    }
    return names;
}

std::vector<std::string> SnippetFetcher::list_allowed_hosts() const {
    return std::vector<std::string>(allowed_hosts_set_.begin(), allowed_hosts_set_.end());
}

bool SnippetFetcher::is_host_allowed(const std::string& host) const {
    if (host.empty()) return false;

    std::string lower_host = host;
    for (char& c : lower_host) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }

    // 1. Check wildcard "*"
    if (allowed_hosts_set_.contains("*")) {
        return true;
    }

    // 2. Direct exact match in allowed_hosts_set_
    if (allowed_hosts_set_.contains(lower_host)) {
        return true;
    }

    // 3. Domain suffix match (e.g. allowed "github.com" matches "raw.github.com")
    for (const auto& allowed : allowed_hosts_set_) {
        if (allowed.starts_with("*.")) {
            std::string suffix = allowed.substr(1); // ".github.com"
            if (lower_host.ends_with(suffix)) return true;
        } else {
            if (lower_host.ends_with("." + allowed)) return true;
        }
    }

    return false;
}

std::string SnippetFetcher::extract_host_from_url(const std::string& url) {
    std::string_view sv = url;
    if (sv.starts_with("http://")) {
        sv.remove_prefix(7);
    } else if (sv.starts_with("https://")) {
        sv.remove_prefix(8);
    } else {
        return "";
    }

    // Find the end of the host/authority component: '/', '?', or '#'
    size_t end_pos = sv.find_first_of("/?#");
    std::string_view authority = (end_pos == std::string_view::npos) ? sv : sv.substr(0, end_pos);

    // If there is userinfo ('@'), skip past it
    size_t at_pos = authority.rfind('@');
    if (at_pos != std::string_view::npos) {
        authority.remove_prefix(at_pos + 1);
    }

    // Handle host and port
    std::string host_str;
    if (authority.starts_with("[")) {
        size_t close_bracket = authority.find(']');
        if (close_bracket != std::string_view::npos) {
            host_str = std::string(authority.substr(1, close_bracket - 1));
        } else {
            host_str = std::string(authority);
        }
    } else {
        size_t colon_pos = authority.find(':');
        if (colon_pos != std::string_view::npos) {
            host_str = std::string(authority.substr(0, colon_pos));
        } else {
            host_str = std::string(authority);
        }
    }

    // Convert to lowercase
    for (char& c : host_str) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return host_str;
}

std::vector<std::string> SnippetFetcher::tokenize_args(const std::string& arg_str) {
    std::vector<std::string> args;
    std::string current;
    bool in_single = false;
    bool in_double = false;
    bool escaped = false;

    for (size_t i = 0; i < arg_str.size(); ++i) {
        char c = arg_str[i];

        if (escaped) {
            current.push_back(c);
            escaped = false;
            continue;
        }

        if (c == '\\' && !in_single) {
            escaped = true;
            continue;
        }

        if (c == '\'' && !in_double) {
            in_single = !in_single;
            continue;
        }

        if (c == '"' && !in_single) {
            in_double = !in_double;
            continue;
        }

        if (std::isspace(static_cast<unsigned char>(c)) && !in_single && !in_double) {
            if (!current.empty()) {
                args.push_back(current);
                current.clear();
            }
            continue;
        }

        current.push_back(c);
    }

    if (!current.empty()) {
        args.push_back(current);
    }

    return args;
}

Result<std::string> SnippetFetcher::substitute_env_vars(
    const std::string& input,
    std::string* missing_var_out
) {
    std::string result;
    result.reserve(input.size());

    size_t i = 0;
    while (i < input.size()) {
        if (input[i] == '$' && i + 1 < input.size() && input[i + 1] == '{') {
            size_t close_brace = input.find('}', i + 2);
            if (close_brace == std::string::npos) {
                if (missing_var_out) *missing_var_out = "Unterminated ${";
                return std::unexpected(ErrorCode::InvalidArgument);
            }
            std::string var_name = input.substr(i + 2, close_brace - (i + 2));
            const char* env_val = std::getenv(var_name.c_str());
            if (!env_val) {
                if (missing_var_out) *missing_var_out = var_name;
                return std::unexpected(ErrorCode::NotFound);
            }
            result.append(env_val);
            i = close_brace + 1;
        } else {
            result.push_back(input[i]);
            ++i;
        }
    }
    return result;
}

Result<ResolvedSnippetRequest> SnippetFetcher::resolve_source(
    const std::string& source,
    std::string* error_msg_out
) const {
    if (source.empty()) {
        if (error_msg_out) *error_msg_out = "Snippet source is empty";
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    // Check for named endpoint prefix (e.g. "mg/foo/bar")
    size_t first_slash = source.find('/');
    std::string prefix = (first_slash != std::string::npos) ? source.substr(0, first_slash) : source;
    std::string path_part = (first_slash != std::string::npos) ? source.substr(first_slash + 1) : "";

    auto ep_it = config_.endpoints.find(prefix);
    if (ep_it != config_.endpoints.end()) {
        const auto& ep = ep_it->second;
        std::string raw_url = ep.url;

        // 1. Replace ${PATH} with path_part
        size_t path_placeholder = raw_url.find("${PATH}");
        if (path_placeholder != std::string::npos) {
            std::string before = raw_url.substr(0, path_placeholder);
            std::string after = raw_url.substr(path_placeholder + 7);

            // If path_part already has query parameters (contains '?'),
            // replace any leading '?' in the 'after' template with '&' to prevent double '?'
            if (path_part.find('?') != std::string::npos && !after.empty() && after[0] == '?') {
                after[0] = '&';
            }
            raw_url = before + path_part + after;
        } else {
            // No ${PATH} explicitly in template; append path_part
            if (!path_part.empty()) {
                if (raw_url.ends_with("/")) {
                    raw_url += path_part;
                } else {
                    raw_url += "/" + path_part;
                }
            }
        }

        // 2. Substitute environment variables in URL
        std::string missing_var;
        auto sub_url_res = substitute_env_vars(raw_url, &missing_var);
        if (!sub_url_res.has_value()) {
            std::string err = "Environment variable '" + missing_var + "' is not set for snippet endpoint '" + prefix + "'";
            if (error_msg_out) *error_msg_out = err;
            return std::unexpected(ErrorCode::InvalidArgument);
        }
        std::string target_url = sub_url_res.value();

        // 3. Process and substitute environment variables in curl_args
        std::string combined_curl_args = config_.default_curl_args;
        if (!ep.curl_args.empty()) {
            if (!combined_curl_args.empty()) combined_curl_args += " ";
            combined_curl_args += ep.curl_args;
        }

        std::string sub_args_str = combined_curl_args;
        if (!combined_curl_args.empty()) {
            auto sub_args_res = substitute_env_vars(combined_curl_args, &missing_var);
            if (!sub_args_res.has_value()) {
                std::string err = "Environment variable '" + missing_var + "' is not set in curl_args for snippet endpoint '" + prefix + "'";
                if (error_msg_out) *error_msg_out = err;
                return std::unexpected(ErrorCode::InvalidArgument);
            }
            sub_args_str = sub_args_res.value();
        }

        std::vector<std::string> args = tokenize_args(sub_args_str);

        // 4. Verify host
        std::string host = extract_host_from_url(target_url);
        if (!is_host_allowed(host)) {
            std::string err = "Host '" + host + "' is not permitted for snippet fetching";
            if (error_msg_out) *error_msg_out = err;
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        return ResolvedSnippetRequest{target_url, args, host, prefix};
    }

    // Direct HTTP/HTTPS URL
    if (source.starts_with("http://") || source.starts_with("https://")) {
        std::string host = extract_host_from_url(source);
        if (!is_host_allowed(host)) {
            std::string err = "Host '" + host + "' is not in the allowed hosts list for snippet fetching";
            if (error_msg_out) *error_msg_out = err;
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        std::string missing_var;
        auto sub_url_res = substitute_env_vars(source, &missing_var);
        if (!sub_url_res.has_value()) {
            std::string err = "Environment variable '" + missing_var + "' is not set in URL";
            if (error_msg_out) *error_msg_out = err;
            return std::unexpected(ErrorCode::InvalidArgument);
        }

        std::string args_str = config_.default_curl_args;
        if (!args_str.empty()) {
            auto sub_args_res = substitute_env_vars(args_str, &missing_var);
            if (sub_args_res.has_value()) {
                args_str = sub_args_res.value();
            }
        }
        std::vector<std::string> args = tokenize_args(args_str);

        return ResolvedSnippetRequest{sub_url_res.value(), args, host, ""};
    }

    std::string err = "Unknown snippet endpoint or invalid URL: '" + source + "'";
    if (error_msg_out) *error_msg_out = err;
    return std::unexpected(ErrorCode::InvalidArgument);
}

CommandResult SnippetFetcher::execute_curl(
    const std::vector<std::string>& curl_args,
    const std::string& target_url,
    int timeout_seconds
) {
    int out_pipe[2];
    int err_pipe[2];

    if (pipe(out_pipe) != 0) {
        return {-1, "", "Failed to create output pipe"};
    }
    if (pipe(err_pipe) != 0) {
        close(out_pipe[0]);
        close(out_pipe[1]);
        return {-1, "", "Failed to create error pipe"};
    }

    pid_t pid = fork();
    if (pid < 0) {
        close(out_pipe[0]); close(out_pipe[1]);
        close(err_pipe[0]); close(err_pipe[1]);
        return {-1, "", "Failed to fork process for curl"};
    }

    if (pid == 0) {
        // Child process
        close(out_pipe[0]);
        close(err_pipe[0]);
        dup2(out_pipe[1], STDOUT_FILENO);
        dup2(err_pipe[1], STDERR_FILENO);
        close(out_pipe[1]);
        close(err_pipe[1]);

        std::vector<std::string> all_args = {
            "curl",
            "-s",
            "-S",
            "-L",
            "--fail",
            "--max-time",
            std::to_string(timeout_seconds)
        };

        for (const auto& a : curl_args) {
            all_args.push_back(a);
        }

        all_args.push_back("--");
        all_args.push_back(target_url);

        std::vector<char*> c_argv;
        c_argv.reserve(all_args.size() + 1);
        for (auto& a : all_args) {
            c_argv.push_back(const_cast<char*>(a.c_str()));
        }
        c_argv.push_back(nullptr);

        execvp("curl", c_argv.data());
        _exit(127);
    }

    // Parent process
    close(out_pipe[1]);
    close(err_pipe[1]);

    std::string stdout_str;
    std::string stderr_str;
    char buffer[4096];
    ssize_t bytes_read;

    while ((bytes_read = read(out_pipe[0], buffer, sizeof(buffer))) > 0) {
        stdout_str.append(buffer, static_cast<size_t>(bytes_read));
    }
    close(out_pipe[0]);

    while ((bytes_read = read(err_pipe[0], buffer, sizeof(buffer))) > 0) {
        stderr_str.append(buffer, static_cast<size_t>(bytes_read));
    }
    close(err_pipe[0]);

    int status = 0;
    waitpid(pid, &status, 0);

    int exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
    return {exit_code, stdout_str, stderr_str};
}

SnippetFetchResult SnippetFetcher::fetch(const std::string& source) const {
    std::string error_msg;
    auto req_res = resolve_source(source, &error_msg);
    if (!req_res.has_value()) {
        int http_status = 400;
        if (req_res.error() == ErrorCode::PermissionDenied) {
            http_status = 403;
        } else if (req_res.error() == ErrorCode::NotFound) {
            http_status = 404;
        }
        return {false, "", error_msg, http_status};
    }

    const auto& req = req_res.value();
    auto cmd_res = execute_curl(req.curl_args, req.target_url, 10);

    if (cmd_res.exit_code != 0) {
        std::string err = cmd_res.stderr_output;
        while (!err.empty() && (err.back() == '\n' || err.back() == '\r')) {
            err.pop_back();
        }
        if (err.empty()) {
            err = "curl exited with status code " + std::to_string(cmd_res.exit_code);
        }
        return {false, "", "Failed to fetch snippet from '" + source + "': " + err, 502};
    }

    return {true, cmd_res.stdout_output, "", 200};
}

} // namespace cme::snippet
