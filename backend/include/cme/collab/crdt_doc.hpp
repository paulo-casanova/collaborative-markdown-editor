/**
 * @file crdt_doc.hpp
 * @brief Modern C++23 RAII wrapper around y-crdt (Yrs) C-FFI for headless CRDT synchronization.
 */

#pragma once

extern "C" {
#include "libyrs.h"
}

#include "cme/common.hpp"
#include <string>
#include <vector>
#include <span>
#include <cstdint>
#include <stdexcept>

namespace cme::collab {

/**
 * @class CrdtDoc
 * @brief RAII container managing a native Yrs collaborative document (YDoc) and text branch.
 */
class CrdtDoc {
public:
    /**
     * @brief Creates a new empty YDoc instance.
     */
    CrdtDoc();

    /**
     * @brief Destructor frees the underlying YDoc.
     */
    ~CrdtDoc();

    // Movable but non-copyable
    CrdtDoc(CrdtDoc&& other) noexcept;
    CrdtDoc& operator=(CrdtDoc&& other) noexcept;
    CrdtDoc(const CrdtDoc&) = delete;
    CrdtDoc& operator=(const CrdtDoc&) = delete;

    /**
     * @brief Retrieves the raw YDoc pointer for custom C-FFI operations.
     */
    [[nodiscard]] YDoc* raw_doc() const noexcept { return doc_; }

    /**
     * @brief Gets current converged text from a named YText branch.
     * @param name Branch name (default: "content").
     * @return Converged UTF-8 string content.
     */
    [[nodiscard]] std::string get_text(const std::string& name = "content") const;

    /**
     * @brief Returns the character length of the named YText branch.
     */
    [[nodiscard]] uint32_t get_text_length(const std::string& name = "content") const;

    /**
     * @brief Inserts plain text into the named YText branch at specified character index.
     */
    void insert_text(uint32_t index, const std::string& text, const std::string& name = "content");

    /**
     * @brief Removes a range of characters from the named YText branch.
     */
    void delete_text(uint32_t index, uint32_t length, const std::string& name = "content");

    /**
     * @brief Replaces the entire content of the named YText branch with new text.
     */
    void set_text(const std::string& text, const std::string& name = "content");

    /**
     * @brief Computes the lib0 v1 state vector representing the current document state.
     * Used for SyncStep1 in the Yjs wire protocol.
     * @return Binary state vector bytes.
     */
    [[nodiscard]] std::vector<uint8_t> get_state_vector() const;

    /**
     * @brief Computes a differential delta (SyncStep2) against a remote peer's state vector.
     * If remote_sv is empty, encodes the full document state as a standard Yjs update.
     * @param remote_sv Binary state vector of the remote peer.
     * @return Binary update payload containing all missing deltas.
     */
    [[nodiscard]] std::vector<uint8_t> get_state_diff(std::span<const uint8_t> remote_sv = {}) const;

    /**
     * @brief Applies an incoming binary CRDT update or delta payload to this document.
     * @param update_data Serialized binary update bytes.
     * @return Result<void> Success or ErrorCode::InvalidArgument on decoding failure.
     */
    Result<void> apply_update(std::span<const uint8_t> update_data);

private:
    YDoc* doc_{nullptr};
};

} // namespace cme::collab
