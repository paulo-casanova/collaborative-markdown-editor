/**
 * @file markdown_renderer.hpp
 * @brief Server-side Markdown to semantic HTML renderer with KaTeX and Mermaid transforms.
 */

#pragma once

#include <string>
#include <string_view>
#include <vector>
#include <optional>

namespace cme::renderer {

/**
 * @struct CommentReview
 * @brief Threaded comment review metadata for document annotations.
 */
struct CommentReview {
    std::string id;
    std::string author_username;
    std::string author_display_name;
    std::string content;
    std::string status{"OPEN"}; ///< "OPEN" or "RESOLVED"
    std::string created_at;
};

/**
 * @struct SuggestionReview
 * @brief Inline edit suggestion metadata.
 */
struct SuggestionReview {
    std::string id;
    std::string author_username;
    std::string author_display_name;
    std::string original_text;
    std::string suggested_text;
    std::string status{"PENDING"}; ///< "PENDING", "ACCEPTED", "REJECTED"
    std::string created_at;
};

/**
 * @struct TaskReview
 * @brief Action item task metadata.
 */
struct TaskReview {
    std::string id;
    std::string description;
    bool is_completed{false};
    std::string assignee_username;
    std::string assignee_display_name;
    std::string created_at;
};

/**
 * @struct ReviewBundle
 * @brief Aggregated review items for a document.
 */
struct ReviewBundle {
    std::vector<CommentReview> comments;
    std::vector<SuggestionReview> suggestions;
    std::vector<TaskReview> tasks;

    [[nodiscard]] bool empty() const noexcept {
        return comments.empty() && suggestions.empty() && tasks.empty();
    }
};

/**
 * @struct RenderOptions
 * @brief Options controlling Markdown to HTML rendering.
 */
struct RenderOptions {
    bool standalone{false};        ///< If true, wrap in full <!DOCTYPE html> document with CSS and scripts.
    std::string title{"Document"}; ///< Page title used when standalone=true.
    bool include_reviews{false};   ///< If true, append reviews & comments section to the output.
};

/**
 * @class MarkdownRenderer
 * @brief High-performance CommonMark/GFM renderer with KaTeX math and Mermaid diagram transforms.
 */
class MarkdownRenderer {
public:
    /**
     * @brief Renders Markdown text to clean semantic HTML.
     * 
     * Transforms applied:
     * - Headings with deterministic anchor IDs (`<h1 id="slug">...</h1>`).
     * - Inline math `$formula$` converted to `<span class="katex-inline" data-expr="formula">$formula$</span>`.
     * - Display math `$$formula$$` converted to `<div class="katex-display" data-expr="formula">$$formula$$</div>`.
     * - Mermaid code fences (```mermaid) converted to `<div class="mermaid">...</div>`.
     * - Wiki links `[[target]]` and `[[target|label]]` converted to `<a class="wiki-link" href="..." data-target="...">`.
     * - GFM tables (`<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>` with alignment).
     * - Task lists (`<li class="task-list-item"><input type="checkbox" disabled ... />`).
     * 
     * @param markdown_text Input Markdown string.
     * @param options Rendering configuration options.
     * @param reviews Review bundle to include if options.include_reviews is true.
     * @return Rendered HTML string.
     */
    static std::string render_to_html(
        std::string_view markdown_text,
        const RenderOptions& options = {},
        const ReviewBundle& reviews = {}
    );
};

} // namespace cme::renderer
