/**
 * @file entity_extractor.cpp
 * @brief Implementation of Markdown entity extraction for mentions, tags, and tasks.
 */

#include "cme/document/entity_extractor.hpp"
#include "cme/auth/crypto_utils.hpp"
#include <sstream>
#include <regex>
#include <cctype>
#include <algorithm>

namespace cme::document {

namespace {

std::string slugify(std::string_view text) {
    std::string slug;
    slug.reserve(text.size());
    for (char c : text) {
        if (std::isalnum(static_cast<unsigned char>(c))) {
            slug.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
        } else if (c == ' ' || c == '-' || c == '_') {
            if (!slug.empty() && slug.back() != '-') {
                slug.push_back('-');
            }
        }
    }
    while (!slug.empty() && slug.back() == '-') {
        slug.pop_back();
    }
    return slug.empty() ? "heading" : slug;
}

bool is_valid_mention_prev_char(char c) {
    if (std::isspace(static_cast<unsigned char>(c))) return true;
    switch (c) {
        case '(':
        case '[':
        case '{':
        case '"':
        case '\'':
        case '<':
        case '/':
        case ':':
        case ',':
        case ';':
        case '-':
        case '=':
            return true;
        default:
            return false;
    }
}

bool is_valid_mention_char(char c) {
    return std::isalnum(static_cast<unsigned char>(c)) || c == '_' || c == '-' || c == '.';
}

void trim_trailing_punctuation(std::string& s) {
    while (!s.empty()) {
        char c = s.back();
        if (c == '.' || c == ',' || c == ';' || c == ':' || c == '!' ||
            c == '?' || c == ')' || c == ']' || c == '}' || c == '"' || c == '\'') {
            s.pop_back();
        } else {
            break;
        }
    }
}

std::string extract_snippet_around(std::string_view line, size_t match_pos, size_t match_len) {
    if (line.empty()) return "";

    // Find sentence start or window
    size_t start = (match_pos > 60) ? (match_pos - 60) : 0;
    while (start < match_pos && line[start] != ' ' && start > 0) {
        start++;
    }

    size_t end = std::min(line.size(), match_pos + match_len + 60);
    while (end < line.size() && line[end] != ' ' && end < match_pos + match_len + 80) {
        end++;
    }

    std::string snippet;
    if (start > 0) snippet += "... ";
    snippet.append(line.data() + start, end - start);
    if (end < line.size()) snippet += " ...";

    // Normalize multiple spaces into single space
    std::string normalized;
    normalized.reserve(snippet.size());
    bool in_space = false;
    for (char c : snippet) {
        if (std::isspace(static_cast<unsigned char>(c))) {
            if (!in_space) {
                normalized.push_back(' ');
                in_space = true;
            }
        } else {
            normalized.push_back(c);
            in_space = false;
        }
    }

    // Trim
    while (!normalized.empty() && normalized.front() == ' ') normalized.erase(normalized.begin());
    while (!normalized.empty() && normalized.back() == ' ') normalized.pop_back();

    return normalized;
}

} // namespace

std::string EntityExtractor::compute_mention_fingerprint(
    std::string_view username,
    std::string_view heading_anchor,
    std::string_view context_snippet
) {
    std::string key;
    key.reserve(username.size() + heading_anchor.size() + context_snippet.size() + 2);
    for (char c : username) {
        key.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    key.push_back(':');
    key.append(heading_anchor);
    key.push_back(':');
    key.append(context_snippet);

    return auth::sha256_hex(key);
}

std::string EntityExtractor::compute_task_fingerprint(
    std::string_view description,
    std::string_view heading_anchor,
    size_t line_number
) {
    std::string key = std::string(heading_anchor) + ":" + std::string(description) + ":" + std::to_string(line_number);
    return auth::sha256_hex(key);
}

ExtractedEntities EntityExtractor::extract_all(std::string_view content) {
    ExtractedEntities result;

    std::string current_heading_title;
    std::string current_heading_anchor;

    bool in_fenced_code = false;
    std::string fence_delim;

    size_t line_start = 0;
    size_t line_num = 1;
    const size_t total_len = content.size();

    while (line_start < total_len) {
        size_t line_end = content.find('\n', line_start);
        if (line_end == std::string_view::npos) {
            line_end = total_len;
        }

        std::string_view line = content.substr(line_start, line_end - line_start);
        if (!line.empty() && line.back() == '\r') {
            line = line.substr(0, line.size() - 1);
        }

        // 1. Check for fenced code block toggle
        size_t sp = 0;
        while (sp < line.size() && sp < 3 && line[sp] == ' ') sp++;
        if (sp + 2 < line.size()) {
            char fchar = line[sp];
            if (fchar == '`' || fchar == '~') {
                size_t fcount = 0;
                while (sp + fcount < line.size() && line[sp + fcount] == fchar) {
                    fcount++;
                }
                if (fcount >= 3) {
                    std::string current_fence = std::string(fcount, fchar);
                    if (!in_fenced_code) {
                        in_fenced_code = true;
                        fence_delim = current_fence;
                    } else if (fchar == fence_delim[0] && fcount >= fence_delim.size()) {
                        in_fenced_code = false;
                        fence_delim.clear();
                    }
                    line_start = (line_end < total_len) ? (line_end + 1) : total_len;
                    line_num++;
                    continue;
                }
            }
        }

        if (in_fenced_code) {
            line_start = (line_end < total_len) ? (line_end + 1) : total_len;
            line_num++;
            continue;
        }

        // 2. Check for Markdown Headings (#+ Title)
        size_t h_sp = 0;
        while (h_sp < line.size() && h_sp < 3 && line[h_sp] == ' ') h_sp++;
        if (h_sp < line.size() && line[h_sp] == '#') {
            size_t h_count = 0;
            while (h_sp + h_count < line.size() && line[h_sp + h_count] == '#') {
                h_count++;
            }
            if (h_count >= 1 && h_count <= 6 && (h_sp + h_count < line.size()) && line[h_sp + h_count] == ' ') {
                size_t title_start = h_sp + h_count + 1;
                while (title_start < line.size() && line[title_start] == ' ') title_start++;
                std::string_view h_title = line.substr(title_start);
                // Strip trailing hashes if present (e.g. ## Title ##)
                while (!h_title.empty() && h_title.back() == ' ') h_title.remove_suffix(1);
                while (!h_title.empty() && h_title.back() == '#') h_title.remove_suffix(1);
                while (!h_title.empty() && h_title.back() == ' ') h_title.remove_suffix(1);

                current_heading_title = std::string(h_title);
                current_heading_anchor = slugify(h_title);
            }
        }

        // 3. Check for Task Items (- [ ] or - [x])
        {
            size_t t_sp = 0;
            while (t_sp < line.size() && line[t_sp] == ' ') t_sp++;
            if (t_sp + 4 < line.size() && (line[t_sp] == '-' || line[t_sp] == '*' || line[t_sp] == '+') && line[t_sp + 1] == ' ') {
                if (line[t_sp + 2] == '[' && (line[t_sp + 3] == ' ' || line[t_sp + 3] == 'x' || line[t_sp + 3] == 'X') && line[t_sp + 4] == ']') {
                    ExtractedTask task;
                    task.raw_line = std::string(line);
                    task.is_completed = (line[t_sp + 3] == 'x' || line[t_sp + 3] == 'X');
                    task.line_number = line_num;
                    task.heading_anchor = current_heading_anchor;

                    std::string task_body = std::string(line.substr(t_sp + 5));
                    while (!task_body.empty() && task_body.front() == ' ') task_body.erase(task_body.begin());

                    // Parse Obsidian emojis
                    static const std::regex due_regex(R"(📅\s*(\d{4}-\d{2}-\d{2}))");
                    static const std::regex sched_regex(R"(⏳\s*(\d{4}-\d{2}-\d{2}))");
                    static const std::regex start_regex(R"(🛫\s*(\d{4}-\d{2}-\d{2}))");
                    static const std::regex done_regex(R"(✅\s*(\d{4}-\d{2}-\d{2}))");
                    static const std::regex priority_regex(R"((🔺|⏫|🔼|🔽|⏬))");
                    static const std::regex assignee_regex(R"((?:\[\[@|@)([a-zA-Z0-9_\-\.]+)(?:\]\])?)");

                    std::smatch m;
                    if (std::regex_search(task_body, m, due_regex)) task.due_date = m[1].str();
                    if (std::regex_search(task_body, m, sched_regex)) task.scheduled_date = m[1].str();
                    if (std::regex_search(task_body, m, start_regex)) task.start_date = m[1].str();
                    if (std::regex_search(task_body, m, done_regex)) task.completion_date = m[1].str();
                    if (std::regex_search(task_body, m, priority_regex)) task.priority = m[1].str();
                    if (std::regex_search(task_body, m, assignee_regex)) task.assignee_username = m[1].str();

                    task.description = task_body;
                    task.fingerprint = compute_task_fingerprint(task.description, task.heading_anchor, task.line_number);
                    result.tasks.push_back(std::move(task));
                }
            }
        }

        // 4. Scan line for inline code, mentions (@user), and tags (#tag)
        bool in_inline_code = false;
        size_t inline_fence_len = 0;
        size_t i = 0;

        while (i < line.size()) {
            // Track inline backticks `...`
            if (line[i] == '`') {
                size_t ticks = 0;
                while (i + ticks < line.size() && line[i + ticks] == '`') {
                    ticks++;
                }
                if (!in_inline_code) {
                    in_inline_code = true;
                    inline_fence_len = ticks;
                } else if (ticks == inline_fence_len) {
                    in_inline_code = false;
                    inline_fence_len = 0;
                }
                i += ticks;
                continue;
            }

            if (in_inline_code) {
                i++;
                continue;
            }

            // Check for @mention
            if (line[i] == '@') {
                bool valid_prefix = (i == 0) || is_valid_mention_prev_char(line[i - 1]);
                if (valid_prefix && (i + 1 < line.size()) && (std::isalnum(static_cast<unsigned char>(line[i + 1])) || line[i + 1] == '_')) {
                    size_t m_start = i + 1;
                    size_t m_end = m_start;
                    while (m_end < line.size() && is_valid_mention_char(line[m_end])) {
                        m_end++;
                    }

                    std::string raw_username = std::string(line.substr(m_start, m_end - m_start));
                    trim_trailing_punctuation(raw_username);

                    if (!raw_username.empty()) {
                        ExtractedMention mention;
                        mention.original_token = "@" + raw_username;
                        std::string lower_u;
                        lower_u.reserve(raw_username.size());
                        for (char c : raw_username) {
                            lower_u.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
                        }
                        mention.username = std::move(lower_u);
                        mention.heading_anchor = current_heading_anchor;
                        mention.heading_title = current_heading_title;
                        mention.line_number = line_num;
                        mention.char_offset = i;
                        mention.context_snippet = extract_snippet_around(line, i, mention.original_token.size());
                        mention.fingerprint = compute_mention_fingerprint(
                            mention.username,
                            mention.heading_anchor,
                            mention.context_snippet
                        );

                        result.mentions.push_back(std::move(mention));
                        i = m_end;
                        continue;
                    }
                }
            }

            // Check for #tag
            if (line[i] == '#') {
                bool valid_prefix = (i == 0) || (line[i - 1] == ' ' || line[i - 1] == '\t' || line[i - 1] == '(' || line[i - 1] == '[');
                // Tag must not be a markdown heading, must start with letter/number/underscore, and not be pure digits (#123)
                if (valid_prefix && (i + 1 < line.size()) && line[i + 1] != ' ' && line[i + 1] != '#') {
                    size_t t_start = i + 1;
                    size_t t_end = t_start;
                    bool has_letter = false;
                    while (t_end < line.size() && (std::isalnum(static_cast<unsigned char>(line[t_end])) || line[t_end] == '_' || line[t_end] == '-' || line[t_end] == '/')) {
                        if (std::isalpha(static_cast<unsigned char>(line[t_end])) || line[t_end] == '_') {
                            has_letter = true;
                        }
                        t_end++;
                    }

                    std::string raw_tag = std::string(line.substr(t_start, t_end - t_start));
                    trim_trailing_punctuation(raw_tag);

                    if (has_letter && !raw_tag.empty()) {
                        ExtractedTag tag;
                        std::string lower_tag;
                        lower_tag.reserve(raw_tag.size());
                        for (char c : raw_tag) {
                            lower_tag.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
                        }
                        tag.tag = std::move(lower_tag);
                        tag.heading_anchor = current_heading_anchor;
                        tag.line_number = line_num;
                        tag.char_offset = i;
                        result.tags.push_back(std::move(tag));
                        i = t_end;
                        continue;
                    }
                }
            }

            i++;
        }

        line_start = (line_end < total_len) ? (line_end + 1) : total_len;
        line_num++;
    }

    return result;
}

std::vector<ExtractedMention> EntityExtractor::extract_mentions(std::string_view content) {
    return extract_all(content).mentions;
}

std::vector<ExtractedTag> EntityExtractor::extract_tags(std::string_view content) {
    return extract_all(content).tags;
}

std::vector<ExtractedTask> EntityExtractor::extract_tasks(std::string_view content) {
    return extract_all(content).tasks;
}

} // namespace cme::document
