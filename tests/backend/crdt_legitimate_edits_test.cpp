#include "cme/collab/crdt_doc.hpp"
#include "cme/collab/document_room.hpp"
#include <cassert>
#include <iostream>

using namespace cme::collab;

int main() {
    std::cout << "====================================================================\n";
    std::cout << "=== CME Legitimate Edits Acceptance Test Suite (Issue #22)       ===\n";
    std::cout << "====================================================================\n";

    // -------------------------------------------------------------------------
    // Test Case 1: Heading substring update (formerly rejected by Condition 2)
    // Document starts with "# Foo\nSome introduction."
    // User types "## Foo Bar\nDetails."
    // "# Foo" is a substring of "## Foo Bar", but must NOT be rejected.
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 1] Heading substring update (# Foo -> ## Foo Bar)...\n";
    {
        std::string initial_content = "# Foo\nSome introduction.";
        DocumentRoom room("doc_test_1", initial_content);

        CrdtDoc client_doc;
        auto initial_diff = room.compute_sync_step2({});
        auto init_apply = client_doc.apply_update(initial_diff);
        assert(init_apply.has_value());
        assert(client_doc.get_text() == initial_content);

        // Alice types "## Foo Bar\nDetails." at the end
        std::string edit_to_append = "\n\n## Foo Bar\nDetails.";
        client_doc.insert_text(static_cast<uint32_t>(client_doc.get_text().size()), edit_to_append);
        std::string expected_after = initial_content + edit_to_append;
        assert(client_doc.get_text() == expected_after);

        // Alice transmits her update to the room
        auto server_sv = room.get_state_vector();
        auto client_update = client_doc.get_state_diff(server_sv);

        auto res = room.apply_client_update(client_update);
        assert(res.has_value());
        assert(room.get_content() == expected_after);
        assert(room.is_dirty());
        std::cout << "  - Heading substring edit accepted successfully.\n";
    }

    // -------------------------------------------------------------------------
    // Test Case 2: Quoting/copying text (formerly rejected by Condition 3)
    // Document has text >= 10 chars.
    // User quotes or references text within the document.
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 2] Quoting/referencing sentence within document...\n";
    {
        std::string initial_content = "This is a meaningful sentence.";
        DocumentRoom room("doc_test_2", initial_content);

        CrdtDoc client_doc;
        auto initial_diff = room.compute_sync_step2({});
        client_doc.apply_update(initial_diff);

        std::string quote = "\n\nAs noted: This is a meaningful sentence.";
        client_doc.insert_text(static_cast<uint32_t>(client_doc.get_text().size()), quote);
        std::string expected_after = initial_content + quote;

        auto server_sv = room.get_state_vector();
        auto client_update = client_doc.get_state_diff(server_sv);

        auto res = room.apply_client_update(client_update);
        assert(res.has_value());
        assert(room.get_content() == expected_after);
        assert(room.is_dirty());
        std::cout << "  - Quoted text edit accepted successfully.\n";
    }

    // -------------------------------------------------------------------------
    // Test Case 3: Intentional duplication / paste below (formerly rejected by Condition 1)
    // User intentionally duplicates a paragraph by pasting it below.
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 3] Intentional paragraph paste duplication...\n";
    {
        std::string initial_content = "Paragraph to duplicate.";
        DocumentRoom room("doc_test_3", initial_content);

        CrdtDoc client_doc;
        auto initial_diff = room.compute_sync_step2({});
        client_doc.apply_update(initial_diff);

        std::string paste = "\nParagraph to duplicate.";
        client_doc.insert_text(static_cast<uint32_t>(client_doc.get_text().size()), paste);
        std::string expected_after = initial_content + paste;

        auto server_sv = room.get_state_vector();
        auto client_update = client_doc.get_state_diff(server_sv);

        auto res = room.apply_client_update(client_update);
        assert(res.has_value());
        assert(room.get_content() == expected_after);
        assert(room.is_dirty());
        std::cout << "  - Duplicated paragraph edit accepted successfully.\n";
    }

    // -------------------------------------------------------------------------
    // Test Case 4: Identical repeated headings across multiple sections
    // E.g. Markdown document with repeated sections like "## Summary"
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 4] Identical section headings across sections...\n";
    {
        std::string initial_content = "# Guide\n\n## Summary\nFirst section.";
        DocumentRoom room("doc_test_4", initial_content);

        CrdtDoc client_doc;
        auto initial_diff = room.compute_sync_step2({});
        client_doc.apply_update(initial_diff);

        std::string second_section = "\n\n# Appendix\n\n## Summary\nSecond section.";
        client_doc.insert_text(static_cast<uint32_t>(client_doc.get_text().size()), second_section);
        std::string expected_after = initial_content + second_section;

        auto server_sv = room.get_state_vector();
        auto client_update = client_doc.get_state_diff(server_sv);

        auto res = room.apply_client_update(client_update);
        assert(res.has_value());
        assert(room.get_content() == expected_after);
        assert(room.is_dirty());
        std::cout << "  - Repeated section headings accepted successfully.\n";
    }

    std::cout << "\n====================================================================\n";
    std::cout << "=== ALL LEGITIMATE EDIT ACCEPTANCE TESTS PASSED SUCCESSFULLY!    ===\n";
    std::cout << "====================================================================\n";
    return 0;
}
