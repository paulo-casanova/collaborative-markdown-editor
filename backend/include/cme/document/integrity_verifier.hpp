/**
 * @file integrity_verifier.hpp
 * @brief Offline integrity checking and reconciliation between POSIX storage and PostgreSQL.
 */

#pragma once

#include "cme/config/config.hpp"

namespace cme::document {

class IntegrityVerifier {
public:
    /**
     * @brief Executes the offline integrity check and reconciliation routine.
     * @param cfg Application configuration containing storage root and database URL.
     * @return 0 if check passes with 0 remaining discrepancies, non-zero otherwise.
     */
    static int run(const config::AppConfig& cfg);
};

} // namespace cme::document
