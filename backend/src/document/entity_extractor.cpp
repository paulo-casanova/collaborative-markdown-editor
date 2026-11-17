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
#include <unordered_map>
#include <filesystem>

namespace cme::document {

namespace {

bool is_valid_utf8(std::string_view sv) {
    size_t i = 0;
    const size_t len = sv.size();
    while (i < len) {
        unsigned char c = static_cast<unsigned char>(sv[i]);
        if (c <= 0x7F) {
            i++;
        } else if ((c & 0xE0) == 0xC0) {
            if (i + 1 >= len || (static_cast<unsigned char>(sv[i + 1]) & 0xC0) != 0x80) return false;
            i += 2;
        } else if ((c & 0xF0) == 0xE0) {
            if (i + 2 >= len ||
                (static_cast<unsigned char>(sv[i + 1]) & 0xC0) != 0x80 ||
                (static_cast<unsigned char>(sv[i + 2]) & 0xC0) != 0x80) return false;
            i += 3;
        } else if ((c & 0xF8) == 0xF0) {
            if (i + 3 >= len ||
                (static_cast<unsigned char>(sv[i + 1]) & 0xC0) != 0x80 ||
                (static_cast<unsigned char>(sv[i + 2]) & 0xC0) != 0x80 ||
                (static_cast<unsigned char>(sv[i + 3]) & 0xC0) != 0x80) return false;
            i += 4;
        } else {
            return false;
        }
    }
    return true;
}

std::optional<ExtractedLink> parse_wikilink_target(std::string_view inner, bool is_embed, size_t line_num) {
    if (!is_valid_utf8(inner)) return std::nullopt;
    size_t pipe = inner.find('|');
    std::string_view target_part = (pipe != std::string_view::npos) ? inner.substr(0, pipe) : inner;

    size_t hash = target_part.find('#');
    std::string_view doc_part = (hash != std::string_view::npos) ? target_part.substr(0, hash) : target_part;

    size_t first = doc_part.find_first_not_of(" \t\r\n");
    if (first == std::string_view::npos) {
        return std::nullopt; // Intra-document link like [[#Heading]]
    }
    size_t last = doc_part.find_last_not_of(" \t\r\n");
    std::string clean_doc(doc_part.substr(first, last - first + 1));

    std::replace(clean_doc.begin(), clean_doc.end(), '\\', '/');
    while (clean_doc.starts_with("./")) {
        clean_doc.erase(0, 2);
    }
    while (!clean_doc.empty() && clean_doc.front() == '/') {
        clean_doc.erase(0, 1);
    }
    while (!clean_doc.empty() && clean_doc.back() == '/') {
        clean_doc.pop_back();
    }

    if (clean_doc.empty()) {
        return std::nullopt;
    }

    // URL decode %20 etc.
    std::string decoded;
    decoded.reserve(clean_doc.size());
    for (size_t idx = 0; idx < clean_doc.size(); ++idx) {
        if (clean_doc[idx] == '%' && idx + 2 < clean_doc.size()) {
            auto hex_val = [](char c) -> int {
                if (c >= '0' && c <= '9') return c - '0';
                if (c >= 'a' && c <= 'f') return c - 'a' + 10;
                if (c >= 'A' && c <= 'F') return c - 'A' + 10;
                return -1;
            };
            int v1 = hex_val(clean_doc[idx + 1]);
            int v2 = hex_val(clean_doc[idx + 2]);
            if (v1 >= 0 && v2 >= 0) {
                decoded.push_back(static_cast<char>((v1 << 4) | v2));
                idx += 2;
                continue;
            }
        }
        decoded.push_back(clean_doc[idx]);
    }
    clean_doc = std::move(decoded);

    std::string norm;
    norm.reserve(clean_doc.size());
    for (char c : clean_doc) {
        norm.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }

    std::filesystem::path p(norm);
    std::string stem = p.stem().string();
    if (norm.ends_with(".bundle")) {
        std::string fn = p.filename().string();
        if (fn.size() > 7) stem = fn.substr(0, fn.size() - 7);
    }

    ExtractedLink link;
    link.raw_target = std::string(inner);
    link.target_norm = std::move(norm);
    link.target_stem = std::move(stem);
    link.link_type = "WIKILINK";
    link.is_embed = is_embed;
    link.line_number = line_num;
    return link;
}

std::optional<ExtractedLink> parse_markdown_target(std::string_view target_view, size_t line_num) {
    if (!is_valid_utf8(target_view)) return std::nullopt;
    size_t first = target_view.find_first_not_of(" \t\r\n");
    if (first == std::string_view::npos) return std::nullopt;
    size_t last = target_view.find_last_not_of(" \t\r\n");
    std::string_view target = target_view.substr(first, last - first + 1);

    // Skip external protocols and pure anchor jumps
    if (target.starts_with("http://") || target.starts_with("https://") ||
        target.starts_with("mailto:") || target.starts_with("data:") ||
        target.starts_with("ftp://") || target.starts_with("#")) {
        return std::nullopt;
    }

    // Strip anchor and query params
    size_t hash = target.find('#');
    if (hash != std::string_view::npos) target = target.substr(0, hash);
    size_t qmark = target.find('?');
    if (qmark != std::string_view::npos) target = target.substr(0, qmark);

    std::string clean(target);
    std::replace(clean.begin(), clean.end(), '\\', '/');
    while (clean.starts_with("./")) clean.erase(0, 2);
    while (!clean.empty() && clean.front() == '/') clean.erase(0, 1);
    while (!clean.empty() && clean.back() == '/') clean.pop_back();

    if (clean.empty()) return std::nullopt;

    // URL decode
    std::string decoded;
    decoded.reserve(clean.size());
    for (size_t idx = 0; idx < clean.size(); ++idx) {
        if (clean[idx] == '%' && idx + 2 < clean.size()) {
            auto hex_val = [](char c) -> int {
                if (c >= '0' && c <= '9') return c - '0';
                if (c >= 'a' && c <= 'f') return c - 'a' + 10;
                if (c >= 'A' && c <= 'F') return c - 'A' + 10;
                return -1;
            };
            int v1 = hex_val(clean[idx + 1]);
            int v2 = hex_val(clean[idx + 2]);
            if (v1 >= 0 && v2 >= 0) {
                decoded.push_back(static_cast<char>((v1 << 4) | v2));
                idx += 2;
                continue;
            }
        }
        decoded.push_back(clean[idx]);
    }
    clean = std::move(decoded);

    std::string norm;
    norm.reserve(clean.size());
    for (char c : clean) {
        norm.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }

    std::filesystem::path p(norm);
    std::string stem = p.stem().string();
    if (norm.ends_with(".bundle")) {
        std::string fn = p.filename().string();
        if (fn.size() > 7) stem = fn.substr(0, fn.size() - 7);
    }

    ExtractedLink link;
    link.raw_target = std::string(target_view);
    link.target_norm = std::move(norm);
    link.target_stem = std::move(stem);
    link.link_type = "MARKDOWN";
    link.is_embed = false;
    link.line_number = line_num;
    return link;
}

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

std::string to_lower_str(std::string_view s) {
    std::string res;
    res.reserve(s.size());
    for (char c : s) {
        res.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    return res;
}

void parse_frontmatter_tags(std::string_view fm_text, std::vector<ExtractedTag>& out_tags) {
    size_t pos = 0;
    bool in_tags_block = false;
    size_t line_num = 2; // Line 1 was '---'

    while (pos < fm_text.size()) {
        size_t next_nl = fm_text.find('\n', pos);
        size_t line_end = (next_nl != std::string_view::npos) ? next_nl : fm_text.size();
        std::string_view line = fm_text.substr(pos, line_end - pos);
        if (!line.empty() && line.back() == '\r') line.remove_suffix(1);

        size_t start_sp = 0;
        while (start_sp < line.size() && (line[start_sp] == ' ' || line[start_sp] == '\t')) start_sp++;
        std::string_view trimmed = line.substr(start_sp);

        if (trimmed.starts_with("tags:") || trimmed.starts_with("tag:")) {
            size_t colon_pos = trimmed.find(':');
            std::string_view val = trimmed.substr(colon_pos + 1);
            while (!val.empty() && (val.front() == ' ' || val.front() == '\t')) val.remove_prefix(1);

            if (val.starts_with('[') && val.find(']') != std::string_view::npos) {
                // Inline array: [tag1, tag2, tag3]
                size_t close_bracket = val.find(']');
                std::string_view inner = val.substr(1, close_bracket - 1);
                size_t item_start = 0;
                while (item_start < inner.size()) {
                    size_t comma = inner.find(',', item_start);
                    size_t item_end = (comma != std::string_view::npos) ? comma : inner.size();
                    std::string_view item = inner.substr(item_start, item_end - item_start);
                    while (!item.empty() && (item.front() == ' ' || item.front() == '"' || item.front() == '\'' || item.front() == '#')) item.remove_prefix(1);
                    while (!item.empty() && (item.back() == ' ' || item.back() == '"' || item.back() == '\'')) item.remove_suffix(1);
                    if (!item.empty()) {
                        ExtractedTag t;
                        t.tag = to_lower_str(item);
                        t.line_number = line_num;
                        t.char_offset = 0;
                        out_tags.push_back(std::move(t));
                    }
                    item_start = (comma != std::string_view::npos) ? comma + 1 : inner.size();
                }
                in_tags_block = false;
            } else if (!val.empty()) {
                std::string_view item = val;
                while (!item.empty() && (item.front() == ' ' || item.front() == '"' || item.front() == '\'' || item.front() == '#')) item.remove_prefix(1);
                while (!item.empty() && (item.back() == ' ' || item.back() == '"' || item.back() == '\'')) item.remove_suffix(1);
                if (!item.empty()) {
                    ExtractedTag t;
                    t.tag = to_lower_str(item);
                    t.line_number = line_num;
                    t.char_offset = 0;
                    out_tags.push_back(std::move(t));
                }
                in_tags_block = false;
            } else {
                in_tags_block = true;
            }
        } else if (in_tags_block) {
            if (trimmed.starts_with("- ")) {
                std::string_view item = trimmed.substr(2);
                while (!item.empty() && (item.front() == ' ' || item.front() == '"' || item.front() == '\'' || item.front() == '#')) item.remove_prefix(1);
                while (!item.empty() && (item.back() == ' ' || item.back() == '"' || item.back() == '\'')) item.remove_suffix(1);
                if (!item.empty()) {
                    ExtractedTag t;
                    t.tag = to_lower_str(item);
                    t.line_number = line_num;
                    t.char_offset = 0;
                    out_tags.push_back(std::move(t));
                }
            } else if (!trimmed.empty()) {
                in_tags_block = false;
            }
        }

        pos = (next_nl != std::string_view::npos) ? next_nl + 1 : fm_text.size();
        line_num++;
    }
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
    size_t occurrence_index
) {
    std::string key = std::string(heading_anchor) + ":" + std::string(description) + ":" + std::to_string(occurrence_index);
    return auth::sha256_hex(key);
}

ExtractedEntities EntityExtractor::extract_all(std::string_view content) {
    ExtractedEntities result;

    std::string current_heading_title;
    std::string current_heading_anchor;
    std::unordered_map<std::string, size_t> task_occ_counts;

    bool in_fenced_code = false;
    std::string fence_delim;

    size_t line_start = 0;
    size_t line_num = 1;
    const size_t total_len = content.size();

    // Check for YAML Frontmatter at document root (--- ... ---)
    if (content.starts_with("---\n") || content.starts_with("---\r\n")) {
        size_t fm_content_start = (content[3] == '\r') ? 5 : 4;
        size_t fm_close_pos = content.find("\n---", fm_content_start);
        if (fm_close_pos != std::string_view::npos) {
            std::string_view fm_text = content.substr(fm_content_start, fm_close_pos - fm_content_start);
            parse_frontmatter_tags(fm_text, result.tags);

            // Locate the start of the next line following the closing ---
            size_t close_eol = content.find('\n', fm_close_pos + 4);
            size_t next_line = (close_eol != std::string_view::npos) ? close_eol + 1 : total_len;

            // Update line number for the consumed frontmatter header
            for (size_t k = 0; k < next_line; ++k) {
                if (content[k] == '\n') line_num++;
            }
            line_start = next_line;
        }
    }

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

        // 3. Check for Task Items (- [ ] or - [x] or * [ ] or + [ ] or 1. [ ])
        {
            size_t t_sp = 0;
            while (t_sp < line.size() && (line[t_sp] == ' ' || line[t_sp] == '\t')) t_sp++;
            size_t bullet_len = 0;
            if (t_sp + 1 < line.size() && (line[t_sp] == '-' || line[t_sp] == '*' || line[t_sp] == '+') && line[t_sp + 1] == ' ') {
                bullet_len = 2;
            } else {
                size_t d = t_sp;
                while (d < line.size() && std::isdigit(static_cast<unsigned char>(line[d]))) d++;
                if (d > t_sp && d + 1 < line.size() && line[d] == '.' && line[d + 1] == ' ') {
                    bullet_len = (d + 2) - t_sp;
                }
            }

            if (bullet_len > 0 && t_sp + bullet_len + 3 <= line.size()) {
                size_t b_start = t_sp + bullet_len;
                if (line[b_start] == '[' && (line[b_start + 1] == ' ' || line[b_start + 1] == 'x' || line[b_start + 1] == 'X') && line[b_start + 2] == ']') {
                    ExtractedTask task;
                    task.raw_line = std::string(line);
                    task.is_completed = (line[b_start + 1] == 'x' || line[b_start + 1] == 'X');
                    task.line_number = line_num;
                    task.heading_anchor = current_heading_anchor;

                    std::string task_body = std::string(line.substr(b_start + 3));
                    while (!task_body.empty() && (task_body.front() == ' ' || task_body.front() == '\t')) task_body.erase(task_body.begin());

                    // Parse deadline (due:YYYY-MM-DD) and assignee (@user)
                    static const std::regex due_regex(R"(\bdue:\s*(\d{4}-\d{2}-\d{2})\b)", std::regex::icase);
                    static const std::regex assignee_regex(R"((?:^|\s)@([a-zA-Z0-9_\-\.]+))");

                    std::smatch m;
                    if (std::regex_search(task_body, m, due_regex)) task.due_date = m[1].str();
                    if (std::regex_search(task_body, m, assignee_regex)) task.assignee_username = m[1].str();

                    // Clean task description of metadata tags for crisp display in UI
                    std::string clean_desc = task_body;
                    clean_desc = std::regex_replace(clean_desc, due_regex, "");
                    clean_desc = std::regex_replace(clean_desc, assignee_regex, "");

                    std::string trimmed_desc;
                    trimmed_desc.reserve(clean_desc.size());
                    bool in_sp = false;
                    for (char c : clean_desc) {
                        if (std::isspace(static_cast<unsigned char>(c))) {
                            if (!in_sp) {
                                trimmed_desc.push_back(' ');
                                in_sp = true;
                            }
                        } else {
                            trimmed_desc.push_back(c);
                            in_sp = false;
                        }
                    }
                    while (!trimmed_desc.empty() && trimmed_desc.front() == ' ') trimmed_desc.erase(trimmed_desc.begin());
                    while (!trimmed_desc.empty() && trimmed_desc.back() == ' ') trimmed_desc.pop_back();

                    task.description = trimmed_desc.empty() ? task_body : trimmed_desc;

                    std::string group_key = task.heading_anchor + ":" + task.description;
                    size_t occ_idx = task_occ_counts[group_key]++;
                    task.fingerprint = compute_task_fingerprint(task.description, task.heading_anchor, occ_idx);

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

            // Check for embed ![[ or wikilink [[
            bool is_embed = (line[i] == '!' && i + 2 < line.size() && line[i + 1] == '[' && line[i + 2] == '[');
            bool is_wiki = (!is_embed && line[i] == '[' && i + 1 < line.size() && line[i + 1] == '[');
            if (is_embed || is_wiki) {
                size_t open_pos = is_embed ? (i + 1) : i;
                size_t inner_start = open_pos + 2;
                size_t close_pos = line.find("]]", inner_start);
                if (close_pos != std::string_view::npos) {
                    std::string_view inner = line.substr(inner_start, close_pos - inner_start);
                    auto parsed_link = parse_wikilink_target(inner, is_embed, line_num);
                    if (parsed_link.has_value()) {
                        result.links.push_back(std::move(*parsed_link));
                    }
                    i = close_pos + 2;
                    continue;
                }
            }

            // Check for standard markdown link: [label](target)
            if (!is_embed && !is_wiki && line[i] == '[') {
                size_t close_bracket = line.find(']', i + 1);
                if (close_bracket != std::string_view::npos && close_bracket + 1 < line.size() && line[close_bracket + 1] == '(') {
                    size_t close_paren = line.find(')', close_bracket + 2);
                    if (close_paren != std::string_view::npos) {
                        std::string_view target_view = line.substr(close_bracket + 2, close_paren - (close_bracket + 2));
                        auto parsed_link = parse_markdown_target(target_view, line_num);
                        if (parsed_link.has_value()) {
                            result.links.push_back(std::move(*parsed_link));
                        }
                    }
                }
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

std::vector<ExtractedLink> EntityExtractor::extract_links(std::string_view content) {
    return extract_all(content).links;
}

} // namespace cme::document
