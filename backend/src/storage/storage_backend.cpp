#include "cme/storage/storage_backend.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include "cme/config/config.hpp"
#include <iostream>

namespace cme::storage {

Result<std::shared_ptr<IStorageBackend>> create_storage_backend(const config::StorageConfig& config) {
    if (config.backend.empty() || config.backend == "posix") {
        try {
            return std::make_shared<PosixStorageBackend>(config.root_path);
        } catch (const std::exception& e) {
            std::cerr << "[ERROR] Failed to initialize PosixStorageBackend at: "
                      << config.root_path << " (" << e.what() << ")\n";
            return std::unexpected(ErrorCode::IoError);
        }
    }

    if (config.backend == "s3") {
        std::cerr << "[ERROR] S3 storage backend requested (bucket: '" << config.s3_bucket
                  << "'), but AWS S3 storage backend module is not yet compiled into this build.\n";
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    std::cerr << "[ERROR] Unknown storage backend requested: '" << config.backend << "'\n";
    return std::unexpected(ErrorCode::InvalidArgument);
}

} // namespace cme::storage
