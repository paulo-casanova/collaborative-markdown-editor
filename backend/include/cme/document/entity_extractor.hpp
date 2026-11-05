/**
 * @file entity_extractor.hpp
 * @brief High-performance Markdown entity parser extracting mentions, tags, and tasks.
 */

#pragma once

#include <string>
#include <string_view>
#include <vector>
#include <optional>
#include <cstddef>

namespace cme::document {

/**
 * @struct ExtractedMention
 * @brief Represents an inline @user mention extracted from markdown content.
 */
struct ExtractedMention {
    std::string username;         ///< Mentioned username (normalized to lowercase).
    std::string original_token;   ///< Exact token as written (e.g. "@alice").
    std::string heading_anchor;   ///< Slug of nearest preceding heading (e.g. "api-design").
    std::string heading_title;    ///< Title of nearest preceding heading.
    std::string context_snippet;  ///< Surrounding line / sentence context.
    size_t line_number{1};        ///< 1-based line number.
    size_t char_offset{0};        ///< 0-based character offset from start of line.
    std::string fingerprint;      ///< Stable SHA-256 fingerprint for deduplication.
};

/**
 * @struct ExtractedTag
 * @brief Represents an inline #tag or hierarchical #tag/subtag extracted from markdown.
 */
struct ExtractedTag {
    std::string tag;              ///< Tag path normalized (e.g. "project/backend").
    std::string heading_anchor;   ///< Slug of nearest preceding heading.
    size_t line_number{1};        ///< 1-based line number.
    size_t char_offset{0};        ///< 0-based character offset from start of line.
};

/**
 * @struct ExtractedTask
 * @brief Represents an inline checklist task item extracted from markdown.
 */
struct ExtractedTask {
    std::string raw_line;                 ///< Full original line.
    std::string description;              ///< Task description text without checkbox & date metadata.
    bool is_completed{false};             ///< True if marked [x] or [X].
    std::optional<std::string> due_date;  ///< Due date parsed from 📅 YYYY-MM-DD.
    std::optional<std::string> scheduled_date; ///< Scheduled date from ⏳ YYYY-MM-DD.
    std::optional<std::string> start_date;     ///< Start date from 🛫 YYYY-MM-DD.
    std::optional<std::string> completion_date;///< Completion date from ✅ YYYY-MM-DD.
    std::optional<std::string> priority;       ///< Priority emoji if present (🔺/⏫/🔼/🔽/⏬).
    std::optional<std::string> assignee_username; ///< Assignee username if present (@user or [[@user]]).
    std::string heading_anchor;           ///< Slug of nearest preceding heading.
    size_t line_number{1};                ///< 1-based line number.
    std::string fingerprint;              ///< Deterministic fingerprint.
};

/**
 * @struct ExtractedEntities
 * @brief Container of all entities discovered in a single markdown scan.
 */
struct ExtractedEntities {
    std::vector<ExtractedMention> mentions;
    std::vector<ExtractedTag> tags;
    std::vector<ExtractedTask> tasks;
};

/**
 * @class EntityExtractor
 * @brief High-performance, single-pass tokenizer extracting mentions, tags, and tasks
 *        from Markdown while strictly ignoring code blocks and inline code spans.
 */
class EntityExtractor {
public:
    /**
     * @brief Extracts all entities (mentions, tags, tasks) in a single pass over markdown text.
     */
    static ExtractedEntities extract_all(std::string_view content);

    /**
     * @brief Specialized extractor for mentions only.
     */
    static std::vector<ExtractedMention> extract_mentions(std::string_view content);

    /**
     * @brief Specialized extractor for tags only.
     */
    static std::vector<ExtractedTag> extract_tags(std::string_view content);

    /**
     * @brief Specialized extractor for tasks only.
     */
    static std::vector<ExtractedTask> extract_tasks(std::string_view content);

    /**
     * @brief Computes a deterministic SHA-256 fingerprint for a mention.
     */
    static std::string compute_mention_fingerprint(
        std::string_view username,
        std::string_view heading_anchor,
        std::string_view context_snippet
    );

    /**
     * @brief Computes a deterministic SHA-256 fingerprint for a task.
     */
    static std::string compute_task_fingerprint(
        std::string_view description,
        std::string_view heading_anchor,
        size_t occurrence_index
    );
};

} // namespace cme::document
