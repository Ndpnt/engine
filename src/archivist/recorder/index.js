import Record from '../../repositories/record.js';

export default class Recorder {
  constructor({ versionsRepository, snapshotsRepository }) {
    if (!versionsRepository || !snapshotsRepository) {
      throw new RangeError('Storage repositories should be defined both for versions and snapshots');
    }

    this.versionsRepository = versionsRepository;
    this.snapshotsRepository = snapshotsRepository;
  }

  async initialize() {
    return Promise.all([ this.versionsRepository.initialize(), this.snapshotsRepository.initialize() ]);
  }

  async finalize() {
    return Promise.all([ this.versionsRepository.finalize(), this.snapshotsRepository.finalize() ]);
  }

  async getLatestSnapshot(serviceId, documentType) {
    return this.snapshotsRepository.findLatestByServiceIdAndDocumentType(serviceId, documentType);
  }

  async recordSnapshot({ serviceId, documentType, fetchDate, mimeType, content }) {
    if (!serviceId) {
      throw new Error('A service ID is required');
    }

    if (!documentType) {
      throw new Error('A document type is required');
    }

    if (!fetchDate) {
      throw new Error('The fetch date of the snapshot is required to ensure data consistency');
    }

    if (!content) {
      throw new Error('A document content is required');
    }

    if (!mimeType) {
      throw new Error('A document mime type is required to ensure data consistency');
    }

    return this.snapshotsRepository.save(new Record({ serviceId, documentType, fetchDate, mimeType, content }));
  }

  async recordVersion({ serviceId, documentType, snapshotId, fetchDate, mimeType, content, isRefilter }) {
    if (!serviceId) {
      throw new Error('A service ID is required');
    }

    if (!documentType) {
      throw new Error('A document type is required');
    }

    if (!snapshotId) {
      throw new Error(`A snapshot ID is required to ensure data consistency for ${serviceId}'s ${documentType}`);
    }

    if (!fetchDate) {
      throw new Error('The fetch date of the snapshot is required to ensure data consistency');
    }

    if (!content) {
      throw new Error('A document content is required');
    }

    if (!mimeType) {
      throw new Error('A document mime type is required to ensure data consistency');
    }

    return this.versionsRepository.save(new Record({ serviceId, documentType, snapshotId, fetchDate, mimeType, content, isRefilter }));
  }

  async recordRefilter(params) {
    return this.recordVersion({ isRefilter: true, ...params });
  }
}
