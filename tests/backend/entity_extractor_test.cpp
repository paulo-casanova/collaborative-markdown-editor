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
            "Tags with space in parentheses (see #important) should work.\n"
            "Direct parentheses like (#not_a_tag) should NOT be tags.\n"
            "Markdown links like [link](#section-anchor) or [foo](#bar) should NOT be tags.\n"
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

        // Verify markdown link anchors and direct parentheses are never extracted as tags
        std::string link_tag_markdown =
            "Check [anchor](#bar) and [other](doc.md#heading) and directly attached (#foo) and [#bracketed].\n";
        auto link_tags = cme::document::EntityExtractor::extract_tags(link_tag_markdown);
        assert(link_tags.empty());

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

    // 4. Links & Wikilinks Extraction Test
    {
        std::cout << "  -> Testing links and wikilinks extraction, anchors, embeds & exclusions...\n";

        std::string link_markdown =
            "# Documentation Index\n\n"
            "Welcome to CME. Please see [[guides/intro.md]] and [[guides/intro.md|Intro Guide]].\n"
            "Check out [[architecture#Overview]] and [[./notes/meeting.md#Actions|Meeting Notes]].\n"
            "An image embed: ![[assets/diagram.png]] and ![[assets/diagram.png|Architecture Diagram]].\n"
            "Intra-document anchor jump [[#Documentation Index]] should be ignored.\n\n"
            "Markdown links: [Architecture Spec](docs/arch.md) and [API Guide](docs/api.md#v1).\n"
            "External markdown links to ignore: [Google](https://google.com) and [Email](mailto:hi@cme.io) and [Anchor](#local).\n\n"
            "Code block exclusions:\n"
            "```markdown\n"
            "[[ignored/code/link.md]]\n"
            "![[ignored/code/embed.png]]\n"
            "```\n"
            "Inline code exclusion: `[[ignored_inline]]`.\n";

        auto links = cme::document::EntityExtractor::extract_links(link_markdown);

        // Expected extracted links:
        // 1: guides/intro.md (wikilink)
        // 2: guides/intro.md|Intro Guide (wikilink)
        // 3: architecture#Overview (wikilink)
        // 4: ./notes/meeting.md#Actions (wikilink)
        // 5: assets/diagram.png (embed wikilink)
        // 6: assets/diagram.png|Architecture Diagram (embed wikilink)
        // 7: docs/arch.md (markdown link)
        // 8: docs/api.md#v1 (markdown link)
        assert(links.size() == 8);

        // Link 1
        assert(links[0].target_norm == "guides/intro.md");
        assert(links[0].target_stem == "intro");
        assert(links[0].link_type == "WIKILINK");
        assert(!links[0].is_embed);

        // Link 2 (alias)
        assert(links[1].target_norm == "guides/intro.md");
        assert(links[1].target_stem == "intro");
        assert(links[1].link_type == "WIKILINK");
        assert(!links[1].is_embed);

        // Link 3 (anchor)
        assert(links[2].target_norm == "architecture");
        assert(links[2].target_stem == "architecture");
        assert(links[2].link_type == "WIKILINK");

        // Link 4 (relative path + anchor + alias)
        assert(links[3].target_norm == "notes/meeting.md");
        assert(links[3].target_stem == "meeting");

        // Link 5 (embed)
        assert(links[4].target_norm == "assets/diagram.png");
        assert(links[4].target_stem == "diagram");
        assert(links[4].is_embed);

        // Link 6 (embed with alias)
        assert(links[5].target_norm == "assets/diagram.png");
        assert(links[5].target_stem == "diagram");
        assert(links[5].is_embed);

        // Link 7 (markdown link)
        assert(links[6].target_norm == "docs/arch.md");
        assert(links[6].target_stem == "arch");
        assert(links[6].link_type == "MARKDOWN");
        assert(!links[6].is_embed);

        // Link 8 (markdown link with anchor)
        assert(links[7].target_norm == "docs/api.md");
        assert(links[7].target_stem == "api");
        assert(links[7].link_type == "MARKDOWN");

        std::cout << "     [PASS] Links and wikilinks extraction, anchors, embeds & exclusions verified.\n";
    }

    std::cout << "[ALL TESTS PASSED] EntityExtractor verified successfully!\n";
    return 0;
}
