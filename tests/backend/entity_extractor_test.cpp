/**
 * @file entity_extractor_test.cpp
 * @brief Unit tests for Markdown EntityExtractor (mentions, tags, and tasks).
 */

#include "cme/document/entity_extractor.hpp"
#include <iostream>
#include <cassert>

int main() {
    std::cout << "[TEST] Starting EntityExtractor Unit Test Suite...\n";

    // 1. Mentions Extraction Test
    {
        std::cout << "  -> Testing mentions extraction and boundary rules...\n";

        std::string markdown =
            "# User Guide\n\n"
            "Hello @alice and @bob_smith, welcome to CME!\n"
            "Please check with @carol. (Trailing period should be stripped)\n"
            "Also ping @dave-dev, and (@eve) in parentheses.\n\n"
            "Do not extract emails like test.user@example.com or support@cme.io!\n\n"
            "Inline code like `@not_a_mention` must be skipped.\n\n"
            "## Development Section\n\n"
            "In this section, ping @frank for reviews.\n\n"
            "```typescript\n"
            "// Code block:\n"
            "const user = '@code_block_user';\n"
            "```\n\n"
            "~~~python\n"
            "# Tilde code block:\n"
            "print('@another_code_user')\n"
            "~~~\n\n"
            "Final sentence with @grace.\n";

        auto entities = cme::document::EntityExtractor::extract_all(markdown);

        // Check mentions count
        // Expected mentions: alice, bob_smith, carol, dave-dev, eve, frank, grace
        assert(entities.mentions.size() == 7);

        assert(entities.mentions[0].username == "alice");
        assert(entities.mentions[0].heading_anchor == "user-guide");
        assert(!entities.mentions[0].fingerprint.empty());

        assert(entities.mentions[1].username == "bob_smith");
        assert(entities.mentions[1].heading_anchor == "user-guide");

        assert(entities.mentions[2].username == "carol");
        assert(entities.mentions[2].original_token == "@carol");

        assert(entities.mentions[3].username == "dave-dev");

        assert(entities.mentions[4].username == "eve");

        assert(entities.mentions[5].username == "frank");
        assert(entities.mentions[5].heading_anchor == "development-section");
        assert(entities.mentions[5].heading_title == "Development Section");

        assert(entities.mentions[6].username == "grace");
        assert(entities.mentions[6].heading_anchor == "development-section");

        // Verify fingerprint determinism
        auto fp1 = cme::document::EntityExtractor::compute_mention_fingerprint("alice", "user-guide", "context");
        auto fp2 = cme::document::EntityExtractor::compute_mention_fingerprint("Alice", "user-guide", "context");
        assert(fp1 == fp2); // Case insensitive username

        std::cout << "     [PASS] Mentions extraction, boundaries, code block exclusion & fingerprints verified.\n";
    }

    // 2. Tags Extraction Test
    {
        std::cout << "  -> Testing tags extraction and exclusions...\n";

        std::string tag_markdown =
            "# Root Heading\n\n"
            "Here is #cme and a nested tag #project/core, plus #v1-release.\n"
            "Parentheses (#important) should work.\n"
            "Headings like # Heading should NOT be tags.\n"
            "Numbers like #123 should NOT be tags.\n"
            "Code spans like `#not_a_tag` should NOT be tags.\n";

        auto tags = cme::document::EntityExtractor::extract_tags(tag_markdown);

        // Expected tags: cme, project/core, v1-release, important
        assert(tags.size() == 4);
        assert(tags[0].tag == "cme");
        assert(tags[1].tag == "project/core");
        assert(tags[2].tag == "v1-release");
        assert(tags[3].tag == "important");

        // Frontmatter Tags (Obsidian YAML metadata)
        std::string fm_markdown =
            "---\n"
            "title: Architecture Spec\n"
            "tags: [obsidian/yaml, architecture]\n"
            "---\n"
            "# Content\n"
            "Here is #inline_tag.\n";

        auto fm_tags = cme::document::EntityExtractor::extract_tags(fm_markdown);
        assert(fm_tags.size() == 3);
        assert(fm_tags[0].tag == "obsidian/yaml");
        assert(fm_tags[1].tag == "architecture");
        assert(fm_tags[2].tag == "inline_tag");

        std::cout << "     [PASS] Tags extraction and exclusions verified.\n";
    }

    // 3. Tasks Extraction Test
    {
        std::cout << "  -> Testing single syntax tasks extraction (@user and due:YYYY-MM-DD)...\n";

        std::string task_markdown =
            "# Sprint 42\n\n"
            "- [ ] Review pull request #101 @alice due:2026-11-15\n"
            "- [x] Write unit tests @bob\n"
            "* [ ] Draft architecture document due:2026-11-10\n"
            "+ [X] Deploy backend service\n"
            "- [ ] Refactor auth module @carol due:2026-11-20\n"
            "1. [ ] Prepare release checklist @david due:2026-12-01\n"
            "- Regular list item (not a task)\n";

        auto tasks = cme::document::EntityExtractor::extract_tasks(task_markdown);

        assert(tasks.size() == 6);

        // Task 1: Uncompleted with due date & assignee
        assert(!tasks[0].is_completed);
        assert(tasks[0].due_date.has_value() && *tasks[0].due_date == "2026-11-15");
        assert(tasks[0].assignee_username.has_value() && *tasks[0].assignee_username == "alice");
        assert(tasks[0].description == "Review pull request #101");
        assert(tasks[0].heading_anchor == "sprint-42");

        // Task 2: Completed with assignee
        assert(tasks[1].is_completed);
        assert(tasks[1].assignee_username.has_value() && *tasks[1].assignee_username == "bob");
        assert(tasks[1].description == "Write unit tests");

        // Task 3: Uncompleted with due date
        assert(!tasks[2].is_completed);
        assert(tasks[2].due_date.has_value() && *tasks[2].due_date == "2026-11-10");
        assert(tasks[2].description == "Draft architecture document");

        // Task 4: Marked with [X]
        assert(tasks[3].is_completed);
        assert(tasks[3].description == "Deploy backend service");

        // Task 5: due:YYYY-MM-DD and @carol
        assert(!tasks[4].is_completed);
        assert(tasks[4].due_date.has_value() && *tasks[4].due_date == "2026-11-20");
        assert(tasks[4].assignee_username.has_value() && *tasks[4].assignee_username == "carol");
        assert(tasks[4].description == "Refactor auth module");

        // Task 6: Numbered task, due:YYYY-MM-DD and @david
        assert(!tasks[5].is_completed);
        assert(tasks[5].due_date.has_value() && *tasks[5].due_date == "2026-12-01");
        assert(tasks[5].assignee_username.has_value() && *tasks[5].assignee_username == "david");
        assert(tasks[5].description == "Prepare release checklist");

        std::cout << "     [PASS] Single syntax task parsing (@user and due:YYYY-MM-DD) verified.\n";
    }

    std::cout << "[ALL TESTS PASSED] EntityExtractor verified successfully!\n";
    return 0;
}
