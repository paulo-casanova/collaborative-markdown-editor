#include "cme/collab/crdt_doc.hpp"
#include <algorithm>
#include <iostream>

namespace cme::collab {

CrdtDoc::CrdtDoc() {
    doc_ = ydoc_new();
}

CrdtDoc::~CrdtDoc() {
    if (doc_) {
        ydoc_destroy(doc_);
        doc_ = nullptr;
    }
}

CrdtDoc::CrdtDoc(CrdtDoc&& other) noexcept
    : doc_(other.doc_) {
    other.doc_ = nullptr;
}

CrdtDoc& CrdtDoc::operator=(CrdtDoc&& other) noexcept {
    if (this != &other) {
        if (doc_) {
            ydoc_destroy(doc_);
        }
        doc_ = other.doc_;
        other.doc_ = nullptr;
    }
    return *this;
}

std::string CrdtDoc::get_text(const std::string& name) const {
    if (!doc_) return "";
    Branch* txt = ytext(doc_, name.c_str());
    if (!txt) return "";

    YTransaction* txn = ydoc_read_transaction(doc_);
    if (!txn) return "";

    char* str = ytext_string(txt, txn);
    std::string result = str ? str : "";
    if (str) {
        ystring_destroy(str);
    }
    ytransaction_commit(txn);
    return result;
}

uint32_t CrdtDoc::get_text_length(const std::string& name) const {
    if (!doc_) return 0;
    Branch* txt = ytext(doc_, name.c_str());
    if (!txt) return 0;

    YTransaction* txn = ydoc_read_transaction(doc_);
    if (!txn) return 0;

    uint32_t len = ytext_len(txt, txn);
    ytransaction_commit(txn);
    return len;
}

void CrdtDoc::insert_text(uint32_t index, const std::string& text, const std::string& name) {
    if (!doc_ || text.empty()) return;
    Branch* txt = ytext(doc_, name.c_str());
    if (!txt) return;

    YTransaction* txn = ydoc_write_transaction(doc_, 0, nullptr);
    if (!txn) return;

    ytext_insert(txt, txn, index, text.c_str(), nullptr);
    ytransaction_commit(txn);
}

void CrdtDoc::delete_text(uint32_t index, uint32_t length, const std::string& name) {
    if (!doc_ || length == 0) return;
    Branch* txt = ytext(doc_, name.c_str());
    if (!txt) return;

    YTransaction* txn = ydoc_write_transaction(doc_, 0, nullptr);
    if (!txn) return;

    uint32_t cur_len = ytext_len(txt, txn);
    if (index < cur_len) {
        uint32_t actual_len = std::min(length, cur_len - index);
        if (actual_len > 0) {
            ytext_remove_range(txt, txn, index, actual_len);
        }
    }
    ytransaction_commit(txn);
}

void CrdtDoc::set_text(const std::string& text, const std::string& name) {
    if (!doc_) return;
    Branch* txt = ytext(doc_, name.c_str());
    if (!txt) return;

    YTransaction* txn = ydoc_write_transaction(doc_, 0, nullptr);
    if (!txn) return;

    uint32_t cur_len = ytext_len(txt, txn);
    if (cur_len > 0) {
        ytext_remove_range(txt, txn, 0, cur_len);
    }
    if (!text.empty()) {
        ytext_insert(txt, txn, 0, text.c_str(), nullptr);
    }
    ytransaction_commit(txn);
}

std::vector<uint8_t> CrdtDoc::get_state_vector() const {
    if (!doc_) return {};
    YTransaction* txn = ydoc_read_transaction(doc_);
    if (!txn) return {};

    uint32_t len = 0;
    char* sv = ytransaction_state_vector_v1(txn, &len);
    std::vector<uint8_t> result;
    if (sv && len > 0) {
        result.assign(
            reinterpret_cast<const uint8_t*>(sv),
            reinterpret_cast<const uint8_t*>(sv) + len
        );
        ybinary_destroy(sv, len);
    }
    ytransaction_commit(txn);
    return result;
}

std::vector<uint8_t> CrdtDoc::get_state_diff(std::span<const uint8_t> remote_sv) const {
    if (!doc_) return {};
    YTransaction* txn = ydoc_read_transaction(doc_);
    if (!txn) return {};

    uint32_t diff_len = 0;
    const char* sv_ptr = remote_sv.empty() ? nullptr : reinterpret_cast<const char*>(remote_sv.data());
    uint32_t sv_len = static_cast<uint32_t>(remote_sv.size());

    char* diff = ytransaction_state_diff_v1(txn, sv_ptr, sv_len, &diff_len);
    std::vector<uint8_t> result;
    if (diff && diff_len > 0) {
        result.assign(
            reinterpret_cast<const uint8_t*>(diff),
            reinterpret_cast<const uint8_t*>(diff) + diff_len
        );
        ybinary_destroy(diff, diff_len);
    }
    ytransaction_commit(txn);
    return result;
}

Result<void> CrdtDoc::apply_update(std::span<const uint8_t> update_data) {
    if (!doc_ || update_data.empty()) return {};

    YTransaction* txn = ydoc_write_transaction(doc_, 0, nullptr);
    if (!txn) return std::unexpected(ErrorCode::InternalError);

    uint8_t res = ytransaction_apply(
        txn,
        reinterpret_cast<const char*>(update_data.data()),
        static_cast<uint32_t>(update_data.size())
    );
    ytransaction_commit(txn);

    if (res != 0) {
        std::cerr << "[ERROR] CrdtDoc::apply_update failed with code: " << static_cast<int>(res) << "\n";
        return std::unexpected(ErrorCode::InvalidArgument);
    }
    return {};
}

} // namespace cme::collab
