/**
 * @file markdown_renderer.cpp
 * @brief High-performance server-side Markdown to HTML renderer using md4c.
 */

#include "cme/renderer/markdown_renderer.hpp"
#include <sstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <cctype>
#include <algorithm>
#include <regex>
#include <vector>
#include <optional>
#include "md4c.h"

namespace cme::renderer {

namespace {

std::string escape_html(std::string_view text) {
    std::string out;
    out.reserve(text.size() + 16);
    for (char c : text) {
        switch (c) {
            case '&':  out.append("&amp;"); break;
            case '<':  out.append("&lt;"); break;
            case '>':  out.append("&gt;"); break;
            case '"':  out.append("&quot;"); break;
            case '\'': out.append("&#39;"); break;
            default:   out.push_back(c); break;
        }
    }
    return out;
}

std::string url_encode(std::string_view text) {
    std::ostringstream escaped;
    escaped.fill('0');
    escaped << std::hex;
    for (char c : text) {
        if (std::isalnum(static_cast<unsigned char>(c)) || c == '-' || c == '_' || c == '.' || c == '~') {
            escaped << c;
        } else {
            escaped << '%' << std::uppercase << static_cast<int>(static_cast<unsigned char>(c));
        }
    }
    return escaped.str();
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

struct ImageDimensionResult {
    std::string alt;
    std::string width;
    std::string height;
};

inline std::optional<std::pair<std::string, std::string>> parse_dim_token(const std::string& token) {
    // 1. Width x Height (e.g. 300x200, 300px x 200px, 50%x50%)
    static const std::regex wxh_re(R"(^(\d+(?:\.\d+)?(?:px|%)?)\s*[xX]\s*(\d+(?:\.\d+)?(?:px|%)?)$)");
    std::smatch m;
    if (std::regex_match(token, m, wxh_re)) {
        std::string w = m[1].str();
        std::string h = m[2].str();
        if (std::regex_match(w, std::regex(R"(^\d+(?:\.\d+)?$)"))) w += "px";
        if (std::regex_match(h, std::regex(R"(^\d+(?:\.\d+)?$)"))) h += "px";
        return std::make_pair(w, h);
    }
    // 2. Height only (e.g. x200, x200px, X300)
    static const std::regex h_re(R"(^[xX]\s*(\d+(?:\.\d+)?)(px|%)?$)");
    if (std::regex_match(token, m, h_re)) {
        std::string unit = m[2].matched ? m[2].str() : "px";
        return std::make_pair("", m[1].str() + unit);
    }
    // 3. Width only (e.g. 300, 300px, 50%)
    static const std::regex w_re(R"(^(\d+(?:\.\d+)?)(px|%)?$)");
    if (std::regex_match(token, m, w_re)) {
        std::string unit = m[2].matched ? m[2].str() : "px";
        return std::make_pair(m[1].str() + unit, "");
    }
    return std::nullopt;
}

inline ImageDimensionResult parse_image_alt_and_dimensions(const std::string& raw_alt) {
    ImageDimensionResult res;
    if (raw_alt.find('|') != std::string::npos) {
        std::stringstream ss(raw_alt);
        std::string segment;
        std::vector<std::string> non_dim_parts;
        while (std::getline(ss, segment, '|')) {
            auto start = segment.find_first_not_of(" \t\r\n");
            auto end = segment.find_last_not_of(" \t\r\n");
            std::string trimmed = (start == std::string::npos) ? "" : segment.substr(start, end - start + 1);
            if (trimmed.empty()) continue;

            auto dim = parse_dim_token(trimmed);
            if (dim) {
                if (!dim->first.empty()) res.width = dim->first;
                if (!dim->second.empty()) res.height = dim->second;
            } else {
                non_dim_parts.push_back(trimmed);
            }
        }
        std::string combined_alt;
        for (size_t i = 0; i < non_dim_parts.size(); ++i) {
            if (i > 0) combined_alt += " | ";
            combined_alt += non_dim_parts[i];
        }
        res.alt = combined_alt;
    } else {
        auto start = raw_alt.find_first_not_of(" \t\r\n");
        auto end = raw_alt.find_last_not_of(" \t\r\n");
        std::string trimmed = (start == std::string::npos) ? "" : raw_alt.substr(start, end - start + 1);
        auto dim = parse_dim_token(trimmed);
        if (dim) {
            if (!dim->first.empty()) res.width = dim->first;
            if (!dim->second.empty()) res.height = dim->second;
            res.alt = "";
        } else {
            res.alt = trimmed;
        }
    }
    return res;
}

struct RenderContext {
    std::string output;

    // Heading state
    bool in_heading{false};
    unsigned heading_level{1};
    std::string heading_html;
    std::string heading_plain;

    // Code block state
    bool in_code_block{false};
    bool is_mermaid{false};
    std::string code_lang;
    std::string code_buf;

    // Math state
    bool in_inline_math{false};
    bool in_display_math{false};
    std::string math_buf;

    // Image state
    bool in_img{false};
    std::string img_src;
    std::string img_title;
    std::string img_alt;

    // Wiki state
    bool in_wikilink{false};
    std::string wiki_target;

    // Heading slug tracking
    std::unordered_map<std::string, int> slug_counts;

    void append_text(std::string_view text) {
        if (in_heading) {
            heading_html.append(escape_html(text));
            heading_plain.append(text);
        } else if (in_inline_math || in_display_math) {
            math_buf.append(text);
        } else if (is_mermaid) {
            code_buf.append(text);
        } else if (in_code_block) {
            output.append(escape_html(text));
        } else if (in_img) {
            img_alt.append(text);
        } else {
            output.append(escape_html(text));
        }
    }

    void append_raw(std::string_view raw) {
        if (in_heading) {
            heading_html.append(raw);
        } else if (is_mermaid || in_inline_math || in_display_math) {
            // No raw markup inside math or mermaid blocks
        } else if (in_img) {
            // Ignore tags in image alt
        } else {
            output.append(raw);
        }
    }
};

int enter_block_cb(MD_BLOCKTYPE type, void* detail, void* userdata) {
    auto* ctx = static_cast<RenderContext*>(userdata);
    switch (type) {
        case MD_BLOCK_DOC:
            break;
        case MD_BLOCK_QUOTE:
            ctx->append_raw("<blockquote>\n");
            break;
        case MD_BLOCK_UL:
            ctx->append_raw("<ul>\n");
            break;
        case MD_BLOCK_OL: {
            auto* d = static_cast<MD_BLOCK_OL_DETAIL*>(detail);
            if (d && d->start != 1) {
                ctx->append_raw("<ol start=\"" + std::to_string(d->start) + "\">\n");
            } else {
                ctx->append_raw("<ol>\n");
            }
            break;
        }
        case MD_BLOCK_LI: {
            auto* d = static_cast<MD_BLOCK_LI_DETAIL*>(detail);
            if (d && d->is_task) {
                ctx->append_raw("<li class=\"task-list-item\"><input type=\"checkbox\" disabled class=\"task-list-item-checkbox\"");
                if (d->task_mark == 'x' || d->task_mark == 'X') {
                    ctx->append_raw(" checked=\"\"");
                }
                ctx->append_raw(" /> ");
            } else {
                ctx->append_raw("<li>");
            }
            break;
        }
        case MD_BLOCK_HR:
            ctx->append_raw("<hr />\n");
            break;
        case MD_BLOCK_H: {
            auto* d = static_cast<MD_BLOCK_H_DETAIL*>(detail);
            ctx->in_heading = true;
            ctx->heading_level = (d && d->level >= 1 && d->level <= 6) ? d->level : 1;
            ctx->heading_html.clear();
            ctx->heading_plain.clear();
            break;
        }
        case MD_BLOCK_CODE: {
            auto* d = static_cast<MD_BLOCK_CODE_DETAIL*>(detail);
            ctx->in_code_block = true;
            ctx->code_buf.clear();
            if (d && d->lang.text) {
                ctx->code_lang = std::string(d->lang.text, d->lang.size);
            } else {
                ctx->code_lang.clear();
            }
            if (ctx->code_lang == "mermaid") {
                ctx->is_mermaid = true;
            } else {
                ctx->is_mermaid = false;
                ctx->append_raw("<pre><code");
                if (!ctx->code_lang.empty()) {
                    ctx->append_raw(" class=\"language-" + escape_html(ctx->code_lang) + "\"");
                }
                ctx->append_raw(">");
            }
            break;
        }
        case MD_BLOCK_HTML:
            // HTML blocks will be handled in on_text (escaped for safety)
            break;
        case MD_BLOCK_P:
            ctx->append_raw("<p>");
            break;
        case MD_BLOCK_TABLE:
            ctx->append_raw("<table>\n");
            break;
        case MD_BLOCK_THEAD:
            ctx->append_raw("<thead>\n");
            break;
        case MD_BLOCK_TBODY:
            ctx->append_raw("<tbody>\n");
            break;
        case MD_BLOCK_TR:
            ctx->append_raw("<tr>\n");
            break;
        case MD_BLOCK_TH: {
            auto* d = static_cast<MD_BLOCK_TD_DETAIL*>(detail);
            std::string tag = "<th";
            if (d) {
                if (d->align == MD_ALIGN_LEFT) tag += " align=\"left\"";
                else if (d->align == MD_ALIGN_CENTER) tag += " align=\"center\"";
                else if (d->align == MD_ALIGN_RIGHT) tag += " align=\"right\"";
            }
            tag += ">";
            ctx->append_raw(tag);
            break;
        }
        case MD_BLOCK_TD: {
            auto* d = static_cast<MD_BLOCK_TD_DETAIL*>(detail);
            std::string tag = "<td";
            if (d) {
                if (d->align == MD_ALIGN_LEFT) tag += " align=\"left\"";
                else if (d->align == MD_ALIGN_CENTER) tag += " align=\"center\"";
                else if (d->align == MD_ALIGN_RIGHT) tag += " align=\"right\"";
            }
            tag += ">";
            ctx->append_raw(tag);
            break;
        }
        default:
            break;
    }
    return 0;
}

int leave_block_cb(MD_BLOCKTYPE type, void* detail, void* userdata) {
    (void)detail;
    auto* ctx = static_cast<RenderContext*>(userdata);
    switch (type) {
        case MD_BLOCK_DOC:
            break;
        case MD_BLOCK_QUOTE:
            ctx->append_raw("</blockquote>\n");
            break;
        case MD_BLOCK_UL:
            ctx->append_raw("</ul>\n");
            break;
        case MD_BLOCK_OL:
            ctx->append_raw("</ol>\n");
            break;
        case MD_BLOCK_LI:
            ctx->append_raw("</li>\n");
            break;
        case MD_BLOCK_HR:
            break;
        case MD_BLOCK_H: {
            ctx->in_heading = false;
            std::string base_slug = slugify(ctx->heading_plain);
            int count = ctx->slug_counts[base_slug]++;
            std::string slug = (count == 0) ? base_slug : base_slug + "-" + std::to_string(count);

            std::string tag = "h" + std::to_string(ctx->heading_level);
            ctx->output.append("<" + tag + " id=\"" + slug + "\">");
            ctx->output.append(ctx->heading_html);
            ctx->output.append("</" + tag + ">\n");
            break;
        }
        case MD_BLOCK_CODE: {
            if (ctx->is_mermaid) {
                ctx->output.append("<div class=\"mermaid\">\n");
                ctx->output.append(escape_html(ctx->code_buf));
                ctx->output.append("\n</div>\n");
                ctx->is_mermaid = false;
            } else {
                ctx->append_raw("</code></pre>\n");
            }
            ctx->in_code_block = false;
            ctx->code_buf.clear();
            ctx->code_lang.clear();
            break;
        }
        case MD_BLOCK_HTML:
            break;
        case MD_BLOCK_P:
            ctx->append_raw("</p>\n");
            break;
        case MD_BLOCK_TABLE:
            ctx->append_raw("</table>\n");
            break;
        case MD_BLOCK_THEAD:
            ctx->append_raw("</thead>\n");
            break;
        case MD_BLOCK_TBODY:
            ctx->append_raw("</tbody>\n");
            break;
        case MD_BLOCK_TR:
            ctx->append_raw("</tr>\n");
            break;
        case MD_BLOCK_TH:
            ctx->append_raw("</th>\n");
            break;
        case MD_BLOCK_TD:
            ctx->append_raw("</td>\n");
            break;
        default:
            break;
    }
    return 0;
}

int enter_span_cb(MD_SPANTYPE type, void* detail, void* userdata) {
    auto* ctx = static_cast<RenderContext*>(userdata);
    switch (type) {
        case MD_SPAN_EM:
            ctx->append_raw("<em>");
            break;
        case MD_SPAN_STRONG:
            ctx->append_raw("<strong>");
            break;
        case MD_SPAN_DEL:
            ctx->append_raw("<del>");
            break;
        case MD_SPAN_U:
            ctx->append_raw("<u>");
            break;
        case MD_SPAN_CODE:
            ctx->append_raw("<code>");
            break;
        case MD_SPAN_A: {
            auto* d = static_cast<MD_SPAN_A_DETAIL*>(detail);
            std::string tag = "<a href=\"" + escape_html(std::string_view(d->href.text, d->href.size)) + "\"";
            if (d->title.text) {
                tag += " title=\"" + escape_html(std::string_view(d->title.text, d->title.size)) + "\"";
            }
            tag += ">";
            ctx->append_raw(tag);
            break;
        }
        case MD_SPAN_IMG: {
            auto* d = static_cast<MD_SPAN_IMG_DETAIL*>(detail);
            ctx->in_img = true;
            ctx->img_src = d ? std::string(d->src.text, d->src.size) : "";
            ctx->img_title = (d && d->title.text) ? std::string(d->title.text, d->title.size) : "";
            ctx->img_alt.clear();
            break;
        }
        case MD_SPAN_WIKILINK: {
            auto* d = static_cast<MD_SPAN_WIKILINK_DETAIL*>(detail);
            ctx->in_wikilink = true;
            ctx->wiki_target = d ? std::string(d->target.text, d->target.size) : "";
            std::string tag = "<a class=\"wiki-link\" href=\"/api/v1/documents/by-path/html?path=" +
                              url_encode(ctx->wiki_target) + "\" data-target=\"" + escape_html(ctx->wiki_target) + "\">";
            ctx->append_raw(tag);
            break;
        }
        case MD_SPAN_LATEXMATH:
            ctx->in_inline_math = true;
            ctx->math_buf.clear();
            break;
        case MD_SPAN_LATEXMATH_DISPLAY:
            ctx->in_display_math = true;
            ctx->math_buf.clear();
            break;
        default:
            break;
    }
    return 0;
}

int leave_span_cb(MD_SPANTYPE type, void* detail, void* userdata) {
    (void)detail;
    auto* ctx = static_cast<RenderContext*>(userdata);
    switch (type) {
        case MD_SPAN_EM:
            ctx->append_raw("</em>");
            break;
        case MD_SPAN_STRONG:
            ctx->append_raw("</strong>");
            break;
        case MD_SPAN_DEL:
            ctx->append_raw("</del>");
            break;
        case MD_SPAN_U:
            ctx->append_raw("</u>");
            break;
        case MD_SPAN_CODE:
            ctx->append_raw("</code>");
            break;
        case MD_SPAN_A:
            ctx->append_raw("</a>");
            break;
        case MD_SPAN_IMG: {
            ctx->in_img = false;
            auto parsed = parse_image_alt_and_dimensions(ctx->img_alt);
            std::string tag = "<img src=\"" + escape_html(ctx->img_src) + "\" alt=\"" + escape_html(parsed.alt) + "\"";
            if (!ctx->img_title.empty()) {
                tag += " title=\"" + escape_html(ctx->img_title) + "\"";
            }
            std::string style = "max-width: 100%;";
            if (!parsed.width.empty()) {
                style += " width: " + parsed.width + ";";
            }
            if (!parsed.height.empty()) {
                style += " height: " + parsed.height + "; object-fit: contain;";
            } else {
                style += " height: auto;";
            }
            tag += " style=\"" + style + "\" />";
            ctx->append_raw(tag);
            ctx->img_src.clear();
            ctx->img_title.clear();
            ctx->img_alt.clear();
            break;
        }
        case MD_SPAN_WIKILINK:
            ctx->in_wikilink = false;
            ctx->wiki_target.clear();
            ctx->append_raw("</a>");
            break;
        case MD_SPAN_LATEXMATH: {
            ctx->in_inline_math = false;
            std::string stub = "<span class=\"katex-inline\" data-expr=\"" + escape_html(ctx->math_buf) + "\">$" +
                               escape_html(ctx->math_buf) + "$</span>";
            ctx->append_raw(stub);
            ctx->math_buf.clear();
            break;
        }
        case MD_SPAN_LATEXMATH_DISPLAY: {
            ctx->in_display_math = false;
            std::string stub = "<div class=\"katex-display\" data-expr=\"" + escape_html(ctx->math_buf) + "\">$$" +
                               escape_html(ctx->math_buf) + "$$</div>";
            ctx->append_raw(stub);
            ctx->math_buf.clear();
            break;
        }
        default:
            break;
    }
    return 0;
}

int text_cb(MD_TEXTTYPE type, const MD_CHAR* text, MD_SIZE size, void* userdata) {
    auto* ctx = static_cast<RenderContext*>(userdata);
    std::string_view sv(text, size);
    switch (type) {
        case MD_TEXT_NORMAL:
        case MD_TEXT_CODE:
        case MD_TEXT_LATEXMATH:
            ctx->append_text(sv);
            break;
        case MD_TEXT_NULLCHAR:
            ctx->append_text("\xEF\xBF\xBD");
            break;
        case MD_TEXT_BR:
            ctx->append_raw("<br />\n");
            break;
        case MD_TEXT_SOFTBR:
            if (ctx->is_mermaid) {
                ctx->code_buf.push_back('\n');
            } else if (ctx->in_code_block) {
                ctx->output.push_back('\n');
            } else if (ctx->in_inline_math || ctx->in_display_math) {
                ctx->math_buf.push_back('\n');
            } else {
                ctx->append_raw("\n");
            }
            break;
        case MD_TEXT_ENTITY:
            ctx->append_raw(sv);
            break;
        case MD_TEXT_HTML:
            ctx->append_text(sv); // Escaped for XSS safety
            break;
        default:
            break;
    }
    return 0;
}

std::string render_reviews_html(const ReviewBundle& reviews) {
    std::ostringstream ss;
    ss << "<section class=\"cme-reviews-section\">\n"
       << "  <h3 id=\"cme-reviews-heading\">Reviews &amp; Comments</h3>\n";

    if (reviews.empty()) {
        ss << "  <p class=\"cme-no-reviews\">No active comments or reviews for this document.</p>\n"
           << "</section>\n";
        return ss.str();
    }

    if (!reviews.comments.empty()) {
        ss << "  <div class=\"cme-reviews-subgroup cme-comments-group\">\n"
           << "    <h4>Comments (" << reviews.comments.size() << ")</h4>\n";
        for (const auto& c : reviews.comments) {
            ss << "    <div class=\"cme-review-item cme-comment-item\" data-id=\"" << escape_html(c.id) << "\">\n"
               << "      <div class=\"cme-review-header\">\n"
               << "        <span class=\"cme-review-author\">" << escape_html(c.author_display_name)
               << " (@" << escape_html(c.author_username) << ")</span>\n"
               << "        <span class=\"cme-review-badge cme-status-" << escape_html(c.status) << "\">"
               << escape_html(c.status) << "</span>\n"
               << "      </div>\n"
               << "      <div class=\"cme-review-content\">" << escape_html(c.content) << "</div>\n"
               << "    </div>\n";
        }
        ss << "  </div>\n";
    }

    if (!reviews.suggestions.empty()) {
        ss << "  <div class=\"cme-reviews-subgroup cme-suggestions-group\">\n"
           << "    <h4>Suggestions (" << reviews.suggestions.size() << ")</h4>\n";
        for (const auto& s : reviews.suggestions) {
            ss << "    <div class=\"cme-review-item cme-suggestion-item\" data-id=\"" << escape_html(s.id) << "\">\n"
               << "      <div class=\"cme-review-header\">\n"
               << "        <span class=\"cme-review-author\">" << escape_html(s.author_display_name)
               << " (@" << escape_html(s.author_username) << ")</span>\n"
               << "        <span class=\"cme-review-badge cme-status-" << escape_html(s.status) << "\">"
               << escape_html(s.status) << "</span>\n"
               << "      </div>\n"
               << "      <div class=\"cme-diff-view\">\n"
               << "        <del class=\"cme-diff-del\">" << escape_html(s.original_text) << "</del>\n"
               << "        <ins class=\"cme-diff-ins\">" << escape_html(s.suggested_text) << "</ins>\n"
               << "      </div>\n"
               << "    </div>\n";
        }
        ss << "  </div>\n";
    }

    if (!reviews.tasks.empty()) {
        ss << "  <div class=\"cme-reviews-subgroup cme-tasks-group\">\n"
           << "    <h4>Action Items (" << reviews.tasks.size() << ")</h4>\n"
           << "    <ul class=\"cme-tasks-list\">\n";
        for (const auto& t : reviews.tasks) {
            ss << "      <li class=\"cme-task-item\" data-id=\"" << escape_html(t.id) << "\">\n"
               << "        <input type=\"checkbox\" disabled" << (t.is_completed ? " checked=\"\"" : "") << " />\n"
               << "        <span class=\"cme-task-desc\">" << escape_html(t.description) << "</span>\n";
            if (!t.assignee_username.empty()) {
                ss << "        <span class=\"cme-task-assignee\">(assigned to @" << escape_html(t.assignee_username) << ")</span>\n";
            }
            ss << "      </li>\n";
        }
        ss << "    </ul>\n"
           << "  </div>\n";
    }

    ss << "</section>\n";
    return ss.str();
}

std::string wrap_standalone(
    std::string_view title,
    std::string_view body_html,
    std::string_view reviews_html
) {
    std::ostringstream ss;
    ss << "<!DOCTYPE html>\n"
       << "<html lang=\"en\">\n"
       << "<head>\n"
       << "  <meta charset=\"utf-8\">\n"
       << "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
       << "  <title>" << escape_html(title) << "</title>\n"
       << "  <link rel=\"stylesheet\" href=\"https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css\">\n"
       << "  <style>\n"
       << "    :root {\n"
       << "      --bg-color: #ffffff;\n"
       << "      --text-color: #1f2937;\n"
       << "      --heading-color: #111827;\n"
       << "      --border-color: #e5e7eb;\n"
       << "      --code-bg: #f3f4f6;\n"
       << "      --table-header-bg: #f9fafb;\n"
       << "      --blockquote-border: #3b82f6;\n"
       << "      --link-color: #2563eb;\n"
       << "    }\n"
       << "    @media (prefers-color-scheme: dark) {\n"
       << "      :root {\n"
       << "        --bg-color: #0f172a;\n"
       << "        --text-color: #e2e8f0;\n"
       << "        --heading-color: #f8fafc;\n"
       << "        --border-color: #334155;\n"
       << "        --code-bg: #1e293b;\n"
       << "        --table-header-bg: #1e293b;\n"
       << "        --blockquote-border: #60a5fa;\n"
       << "        --link-color: #38bdf8;\n"
       << "      }\n"
       << "    }\n"
       << "    body {\n"
       << "      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;\n"
       << "      line-height: 1.6;\n"
       << "      color: var(--text-color);\n"
       << "      background-color: var(--bg-color);\n"
       << "      margin: 0;\n"
       << "      padding: 2rem 1rem;\n"
       << "      display: flex;\n"
       << "      justify-content: center;\n"
       << "    }\n"
       << "    .cme-container {\n"
       << "      max-width: 860px;\n"
       << "      width: 100%;\n"
       << "    }\n"
       << "    h1, h2, h3, h4, h5, h6 {\n"
       << "      color: var(--heading-color);\n"
       << "      font-weight: 600;\n"
       << "      margin-top: 1.5em;\n"
       << "      margin-bottom: 0.5em;\n"
       << "      line-height: 1.25;\n"
       << "    }\n"
       << "    h1 { font-size: 2rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.3em; }\n"
       << "    h2 { font-size: 1.5rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.25em; }\n"
       << "    h3 { font-size: 1.25rem; }\n"
       << "    p, ul, ol, blockquote, table, pre { margin-top: 0; margin-bottom: 1rem; }\n"
       << "    a { color: var(--link-color); text-decoration: none; }\n"
       << "    a:hover { text-decoration: underline; }\n"
       << "    a.wiki-link { border-bottom: 1px dashed var(--link-color); }\n"
       << "    code {\n"
       << "      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;\n"
       << "      font-size: 0.9em;\n"
       << "      background-color: var(--code-bg);\n"
       << "      padding: 0.2em 0.4em;\n"
       << "      border-radius: 4px;\n"
       << "    }\n"
       << "    pre {\n"
       << "      background-color: var(--code-bg);\n"
       << "      padding: 1rem;\n"
       << "      border-radius: 6px;\n"
       << "      overflow-x: auto;\n"
       << "    }\n"
       << "    pre code { background: none; padding: 0; }\n"
       << "    table {\n"
       << "      width: 100%;\n"
       << "      border-collapse: collapse;\n"
       << "      margin-bottom: 1.5rem;\n"
       << "    }\n"
       << "    th, td {\n"
       << "      border: 1px solid var(--border-color);\n"
       << "      padding: 0.5rem 0.75rem;\n"
       << "      text-align: left;\n"
       << "    }\n"
       << "    th { background-color: var(--table-header-bg); font-weight: 600; }\n"
       << "    tr:nth-child(even) td { background-color: rgba(128, 128, 128, 0.04); }\n"
       << "    blockquote {\n"
       << "      border-left: 4px solid var(--blockquote-border);\n"
       << "      padding: 0.5rem 1rem;\n"
       << "      color: #64748b;\n"
       << "      background-color: rgba(59, 130, 246, 0.05);\n"
       << "      border-radius: 0 4px 4px 0;\n"
       << "    }\n"
       << "    hr {\n"
       << "      border: 0;\n"
       << "      height: 1px;\n"
       << "      background-color: var(--border-color);\n"
       << "      margin: 2rem 0;\n"
       << "    }\n"
       << "    .task-list-item { list-style-type: none; }\n"
       << "    .task-list-item input[type=\"checkbox\"] { margin-right: 0.5rem; }\n"
       << "    .mermaid {\n"
       << "      text-align: center;\n"
       << "      margin: 1.5rem 0;\n"
       << "      background: var(--code-bg);\n"
       << "      padding: 1rem;\n"
       << "      border-radius: 6px;\n"
       << "    }\n"
       << "    .katex-display {\n"
       << "      margin: 1rem 0;\n"
       << "      overflow-x: auto;\n"
       << "      text-align: center;\n"
       << "    }\n"
       << "    .cme-reviews-section {\n"
       << "      margin-top: 3rem;\n"
       << "      padding-top: 1.5rem;\n"
       << "      border-top: 2px solid var(--border-color);\n"
       << "    }\n"
       << "    .cme-review-item {\n"
       << "      padding: 0.75rem 1rem;\n"
       << "      border: 1px solid var(--border-color);\n"
       << "      border-radius: 6px;\n"
       << "      margin-bottom: 0.75rem;\n"
       << "      background-color: rgba(59, 130, 246, 0.03);\n"
       << "    }\n"
       << "    .cme-review-header {\n"
       << "      font-size: 0.85rem;\n"
       << "      color: #64748b;\n"
       << "      margin-bottom: 0.25rem;\n"
       << "      display: flex;\n"
       << "      justify-content: space-between;\n"
       << "    }\n"
       << "    .cme-review-author { font-weight: 600; color: var(--heading-color); }\n"
       << "    .cme-review-badge {\n"
       << "      display: inline-block;\n"
       << "      font-size: 0.75rem;\n"
       << "      padding: 0.15rem 0.5rem;\n"
       << "      border-radius: 9999px;\n"
       << "      background-color: #dbeafe;\n"
       << "      color: #1e40af;\n"
       << "      text-transform: uppercase;\n"
       << "      font-weight: 600;\n"
       << "    }\n"
       << "    .cme-diff-del {\n"
       << "      background-color: #fee2e2;\n"
       << "      color: #991b1b;\n"
       << "      text-decoration: line-through;\n"
       << "      padding: 0.1rem 0.3rem;\n"
       << "      border-radius: 3px;\n"
       << "      margin-right: 0.5rem;\n"
       << "    }\n"
       << "    .cme-diff-ins {\n"
       << "      background-color: #dcfce7;\n"
       << "      color: #166534;\n"
       << "      text-decoration: none;\n"
       << "      padding: 0.1rem 0.3rem;\n"
       << "      border-radius: 3px;\n"
       << "    }\n"
       << "    .cme-pill {\n"
       << "      display: inline-flex;\n"
       << "      align-items: center;\n"
       << "      gap: 0.35rem;\n"
       << "      padding: 0.1rem 0.55rem;\n"
       << "      border-radius: 9999px;\n"
       << "      font-size: 0.75rem;\n"
       << "      font-weight: 500;\n"
       << "      border: 1px solid var(--border-color);\n"
       << "      background-color: var(--code-bg);\n"
       << "      color: var(--text-color);\n"
       << "      line-height: 1.3;\n"
       << "      margin: 0 0.2rem;\n"
       << "      vertical-align: baseline;\n"
       << "    }\n"
       << "    .cme-pill-green, .cme-pill-emerald { background-color: rgba(16, 185, 129, 0.15); color: #059669; border-color: rgba(16, 185, 129, 0.3); }\n"
       << "    .cme-pill-amber, .cme-pill-yellow { background-color: rgba(245, 158, 11, 0.15); color: #d97706; border-color: rgba(245, 158, 11, 0.3); }\n"
       << "    .cme-pill-red, .cme-pill-rose { background-color: rgba(244, 63, 94, 0.15); color: #e11d48; border-color: rgba(244, 63, 94, 0.3); }\n"
       << "    .cme-pill-blue, .cme-pill-sky { background-color: rgba(14, 165, 233, 0.15); color: #0284c7; border-color: rgba(14, 165, 233, 0.3); }\n"
       << "    .cme-pill-purple, .cme-pill-violet { background-color: rgba(168, 85, 247, 0.15); color: #9333ea; border-color: rgba(168, 85, 247, 0.3); }\n"
       << "    .cme-pill-pink { background-color: rgba(236, 72, 153, 0.15); color: #db2777; border-color: rgba(236, 72, 153, 0.3); }\n"
       << "    .cme-pill-slate, .cme-pill-gray { background-color: rgba(148, 163, 184, 0.15); color: #475569; border-color: rgba(148, 163, 184, 0.3); }\n"
       << "  </style>\n"
       << "  <script defer src=\"https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js\"></script>\n"
       << "  <script defer src=\"https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js\" onload=\"if (window.renderMathInElement) renderMathInElement(document.body);\"></script>\n"
       << "  <script type=\"module\">\n"
       << "    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';\n"
       << "    mermaid.initialize({ startOnLoad: true });\n"
       << "  </script>\n"
       << "</head>\n"
       << "<body>\n"
       << "  <div class=\"cme-container\">\n"
       << "    <article class=\"cme-content\">\n"
       << body_html << "\n"
       << "    </article>\n"
       << (reviews_html.empty() ? "" : reviews_html)
       << "  </div>\n"
       << "</body>\n"
       << "</html>\n";
    return ss.str();
}

std::string render_pills_in_html(std::string_view html) {
    static const std::regex pill_rx(R"(\[(pill|status|priority):(?:([a-zA-Z0-9#_-]+)\|)?([^\]\n]+)\])");
    std::string text(html);
    std::string result;
    std::string::const_iterator search_start(text.cbegin());
    std::smatch match;

    while (std::regex_search(search_start, text.cend(), match, pill_rx)) {
        result.append(search_start, match[0].first);
        std::string prefix = match[1].str();
        std::string color = match[2].matched ? match[2].str() : "slate";
        std::string label = match[3].str();

        if (prefix == "status") {
            std::string norm = label;
            for (auto& c : norm) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            if (norm == "done" || norm == "completed") { color = "green"; label = "Done"; }
            else if (norm == "in-progress" || norm == "in progress") { color = "amber"; label = "In Progress"; }
            else if (norm == "blocked") { color = "rose"; label = "Blocked"; }
            else { color = "blue"; }
        } else if (prefix == "priority") {
            std::string norm = label;
            for (auto& c : norm) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            for (auto& c : label) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
            if (norm == "p0" || norm == "high" || norm == "urgent" || norm == "critical") { color = "rose"; }
            else if (norm == "p1" || norm == "medium") { color = "amber"; }
            else { color = "blue"; }
        }

        std::string pill_html = "<span class=\"cme-pill cme-pill-" + escape_html(color) + "\" data-color=\"" + escape_html(color) + "\">" + escape_html(label) + "</span>";
        result.append(pill_html);
        search_start = match[0].second;
    }
    result.append(search_start, text.cend());
    return result;
}

inline std::string normalize_markdown_links_with_spaces(std::string_view input) {
    std::string output;
    output.reserve(input.size() + 64);

    std::istringstream stream{std::string(input)};
    std::string line;
    bool in_fence = false;

    // Matches !?[alt](destination)
    static const std::regex link_re(R"((!?\[[^\]]*\])\(([^)\n]+)\))");
    // Matches ![[target]] or ![[target|altOrSize]]
    static const std::regex embed_re(R"(!\[\[([^\]|]+)(?:\|([^\]]+))?\]\])");

    while (std::getline(stream, line)) {
        // Check for fence start/end (``` or ~~~)
        auto trimmed_start = line.find_first_not_of(" \t");
        if (trimmed_start != std::string::npos && (line.compare(trimmed_start, 3, "```") == 0 || line.compare(trimmed_start, 3, "~~~") == 0)) {
            in_fence = !in_fence;
            output.append(line);
            output.push_back('\n');
            continue;
        }

        if (in_fence) {
            output.append(line);
            output.push_back('\n');
            continue;
        }

        // 1. Transform Obsidian image embeds ![[image.png|altOrSize]] to standard Markdown images ![altOrSize](<image.png>)
        std::string line_with_embeds;
        {
            auto search_start = line.cbegin();
            std::smatch match;
            while (std::regex_search(search_start, line.cend(), match, embed_re)) {
                line_with_embeds.append(search_start, match[0].first);
                std::string target = match[1].str();
                std::string alt = match[2].matched ? match[2].str() : "";

                auto t_start = target.find_first_not_of(" \t");
                auto t_end = target.find_last_not_of(" \t");
                if (t_start != std::string::npos) target = target.substr(t_start, t_end - t_start + 1);

                std::string lower_target = target;
                for (auto& c : lower_target) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

                if (lower_target.ends_with(".png") || lower_target.ends_with(".jpg") ||
                    lower_target.ends_with(".jpeg") || lower_target.ends_with(".gif") ||
                    lower_target.ends_with(".svg") || lower_target.ends_with(".webp") ||
                    lower_target.ends_with(".bmp") || lower_target.ends_with(".ico")) {
                    line_with_embeds.append("![");
                    line_with_embeds.append(alt);
                    line_with_embeds.append("](<");
                    line_with_embeds.append(target);
                    line_with_embeds.append(">)");
                } else {
                    line_with_embeds.append(match[0].str());
                }
                search_start = match[0].second;
            }
            line_with_embeds.append(search_start, line.cend());
        }

        // 2. Normalize standard markdown links/images: !?[alt](dest with spaces) -> !?[alt](<dest with spaces>)
        std::string transformed;
        auto search_start = line_with_embeds.cbegin();
        std::smatch match;
        while (std::regex_search(search_start, line_with_embeds.cend(), match, link_re)) {
            transformed.append(search_start, match[0].first);
            std::string prefix = match[1].str();
            std::string raw_dest = match[2].str();

            auto start_pos = raw_dest.find_first_not_of(" \t");
            if (start_pos != std::string::npos && raw_dest[start_pos] != '<') {
                std::string target = raw_dest.substr(start_pos);
                auto end_pos = target.find_last_not_of(" \t");
                if (end_pos != std::string::npos) target = target.substr(0, end_pos + 1);

                std::string dest_part = target;
                std::string extra_part;

                // Check for trailing title in quotes: "title" or 'title'
                static const std::regex title_re(R"(\s+(["'][^"']*["'])\s*$)");
                std::smatch tm;
                if (std::regex_search(target, tm, title_re)) {
                    dest_part = target.substr(0, static_cast<size_t>(tm.position(0)));
                    extra_part = " " + tm[1].str();
                }

                // Check for trailing dimension: =300x200 or =50%
                static const std::regex dim_re(R"(\s+(=(?:(?:\d+(?:\.\d+)?(?:px|%)?)\s*[xX]\s*(?:\d+(?:\.\d+)?(?:px|%)?)|(?:\d+(?:\.\d+)?)(?:px|%)?|[xX]\s*(?:\d+(?:\.\d+)?)(?:px|%)?))\s*$)");
                std::smatch dm;
                bool had_dim = false;
                if (std::regex_search(dest_part, dm, dim_re)) {
                    had_dim = true;
                    std::string dim_str = dm[1].str();
                    dest_part = dest_part.substr(0, static_cast<size_t>(dm.position(0)));
                    if (dim_str.starts_with("=")) dim_str = dim_str.substr(1);
                    if (!prefix.empty() && prefix.back() == ']') {
                        prefix.pop_back();
                        if (prefix.size() > 2 && prefix.back() != '[') {
                            prefix += "|" + dim_str + "]";
                        } else {
                            prefix += dim_str + "]";
                        }
                    }
                }

                if (dest_part.find(' ') != std::string::npos) {
                    transformed.append(prefix);
                    transformed.push_back('(');
                    transformed.push_back('<');
                    transformed.append(dest_part);
                    transformed.push_back('>');
                    transformed.append(extra_part);
                    transformed.push_back(')');
                } else if (had_dim) {
                    transformed.append(prefix);
                    transformed.push_back('(');
                    transformed.append(dest_part);
                    transformed.append(extra_part);
                    transformed.push_back(')');
                } else {
                    transformed.append(match[0].str());
                }
            } else {
                transformed.append(match[0].str());
            }

            search_start = match[0].second;
        }
        transformed.append(search_start, line_with_embeds.cend());
        output.append(transformed);
        output.push_back('\n');
    }

    if (!input.empty() && input.back() != '\n' && !output.empty() && output.back() == '\n') {
        output.pop_back();
    }
    return output;
}

} // namespace

std::string MarkdownRenderer::render_to_html(
    std::string_view markdown_text,
    const RenderOptions& options,
    const ReviewBundle& reviews
) {
    std::string normalized_input = normalize_markdown_links_with_spaces(markdown_text);
    MD_PARSER parser = {
        0,
        MD_DIALECT_GITHUB | MD_FLAG_LATEXMATHSPANS | MD_FLAG_WIKILINKS,
        enter_block_cb,
        leave_block_cb,
        enter_span_cb,
        leave_span_cb,
        text_cb,
        nullptr,
        nullptr
    };

    RenderContext ctx;
    md_parse(normalized_input.data(), static_cast<MD_SIZE>(normalized_input.size()), &parser, &ctx);

    std::string processed_output = render_pills_in_html(ctx.output);

    std::string reviews_html;
    if (options.include_reviews) {
        reviews_html = render_reviews_html(reviews);
    }

    if (options.standalone) {
        return wrap_standalone(options.title, processed_output, reviews_html);
    }

    std::ostringstream ss;
    ss << "<article class=\"cme-content\">\n"
       << processed_output
       << "</article>\n"
       << reviews_html;
    return ss.str();
}

} // namespace cme::renderer
