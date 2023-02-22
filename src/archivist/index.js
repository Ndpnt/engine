import events from 'events';

import async from 'async';
import config from 'config';

import { InaccessibleContentError } from './errors.js';
import extract from './extract/index.js';
import fetch, { launchHeadlessBrowser, stopHeadlessBrowser, FetchDocumentError } from './fetcher/index.js';
import Recorder from './recorder/index.js';
import * as services from './services/index.js';

// The parallel handling feature is currently set to a parallelism of 1 on terms tracking
// because when it's higher there are two issues:
// - too many requests on the same endpoint yield 403
// - sometimes when creating a commit no SHA are returned for unknown reasons
const MAX_PARALLEL_TERMS_TRACKS = 1;
const MAX_PARALLEL_TERMS_TRACKS_WITH_EXTRACT_ONLY = 10;

export const AVAILABLE_EVENTS = [
  'snapshotRecorded',
  'firstSnapshotRecorded',
  'snapshotNotChanged',
  'versionRecorded',
  'firstVersionRecorded',
  'versionNotChanged',
  'trackingStarted',
  'trackingCompleted',
  'inaccessibleContent',
  'error',
];

export default class Archivist extends events.EventEmitter {
  get serviceDeclarations() {
    return this.services;
  }

  get serviceIds() {
    return Object.keys(this.services);
  }

  constructor({ recorderConfig }) {
    super();
    this.recorder = new Recorder(recorderConfig);
    this.fetch = params => fetch({ ...params, config: config.get('fetcher') });
    this.extract = extract;
  }

  async initialize() {
    if (this.services) {
      return;
    }

    await this.recorder.initialize();
    this.initQueue();
    this.services = await services.load();

    this.on('error', async () => {
      console.log('Abort and clean up operations before exiting…');

      setTimeout(() => {
        console.log('Cleaning timed out, force process to exit');
        process.exit(2);
      }, 60 * 1000);

      this.trackingQueue.kill();
      await stopHeadlessBrowser().then(() => console.log('Headless browser stopped'));
      await this.recorder.finalize().then(() => console.log('Recorder finalized'));
      process.exit(1);
    });
  }

  initQueue() {
    this.trackingQueue = async.queue(this.trackTermsChanges.bind(this), MAX_PARALLEL_TERMS_TRACKS);
    this.trackingQueue.error(async (error, { terms }) => {
      const { service, termsType } = terms;

      if (error.toString().includes('HttpError: API rate limit exceeded for user ID')) {
        return; // This is an error due to SendInBlue quota, bypass
      }

      if (error instanceof InaccessibleContentError) {
        this.emit('inaccessibleContent', error, service.id, termsType, terms);

        return;
      }

      this.emit('error', error, service.id, termsType);
    });
  }

  attach(listener) {
    AVAILABLE_EVENTS.forEach(event => {
      const handlerName = `on${event[0].toUpperCase()}${event.substring(1)}`;

      if (listener[handlerName]) {
        this.on(event, listener[handlerName].bind(listener));
      }
    });
  }

  async trackAllTermsChanges({ servicesIds = this.serviceIds, termsTypes = [], extractOnly }) {
    this.emit('trackingStarted', servicesIds.length, this.getNumberOfTerms(servicesIds), extractOnly);

    await Promise.all([ launchHeadlessBrowser(), this.recorder.initialize() ]);

    this.trackingQueue.concurrency = extractOnly ? MAX_PARALLEL_TERMS_TRACKS_WITH_EXTRACT_ONLY : MAX_PARALLEL_TERMS_TRACKS;

    this.#forEachTermsOf(servicesIds, termsTypes, terms => this.trackingQueue.push({ terms, extractOnly }));

    await this.trackingQueue.drain();
    await Promise.all([ stopHeadlessBrowser(), this.recorder.finalize() ]);

    this.emit('trackingCompleted', servicesIds.length, this.getNumberOfTerms(servicesIds), extractOnly);
  }

  async trackTermsChanges({ terms, extractOnly }) {
    if (!extractOnly) {
      await Promise.all((await this.fetchTermsDocuments(terms)).map(params => this.recordSnapshot(params)));
    }

    const { service: { id: serviceId }, termsType, documents } = terms;

    const snapshots = await this.getTermsSnapshots(terms);

    if (!snapshots.length) {
      return;
    }

    const [{ fetchDate }] = snapshots; // In case of multi documents terms, use the first snapshot fetch date

    return this.recordVersion({
      content: await this.extractVersionContent(snapshots, documents),
      snapshotIds: snapshots.map(({ id }) => id),
      serviceId,
      termsType,
      fetchDate,
      extractOnly,
    });
  }

  async fetchTermsDocuments({ service: { id: serviceId }, termsType, documents, isMultiDocument }) {
    const inaccessibleContentErrors = [];

    const result = await Promise.all(documents.map(async ({ location: url, executeClientScripts, cssSelectors, id: documentId }) => {
      try {
        const { mimeType, content } = await this.fetch({ url, executeClientScripts, cssSelectors });

        return {
          content,
          mimeType,
          serviceId,
          termsType,
          documentId: isMultiDocument && documentId,
          fetchDate: new Date(),
        };
      } catch (error) {
        if (!(error instanceof FetchDocumentError)) {
          throw error;
        }

        if (error.message.includes('EAI_AGAIN')) {
          // EAI_AGAIN is a DNS lookup timed out error, which means it is a network connectivity error or proxy related error.
          // This operational error is mostly transient and should be handled by retrying the operation.
          // As there is no retry mechanism in the engine yet, crash the engine and leave it to the process
          // manager to handle the retries and the delay between them.
          throw error;
        }

        inaccessibleContentErrors.push(error.message);
      }
    }));

    if (inaccessibleContentErrors.length) {
      throw new InaccessibleContentError(inaccessibleContentErrors);
    }

    return result;
  }

  async getTermsSnapshots({ service: { id: serviceId }, termsType, documents, isMultiDocument }) {
    return (await Promise.all(documents.map(async document => this.recorder.getLatestSnapshot(serviceId, termsType, isMultiDocument && document.id)))).filter(Boolean);
  }

  async extractVersionContent(snapshots, documents) {
    return (
      await Promise.all(snapshots.map(async ({ documentId, content, mimeType }) => {
        const document = documentId ? documents.find(({ id }) => documentId == id) : documents[0];

        return this.extract({ content, mimeType, document });
      }))
    ).join('\n\n');
  }

  async recordSnapshot({ content, mimeType, fetchDate, serviceId, termsType, documentId }) {
    const { id: snapshotId, isFirstRecord } = await this.recorder.recordSnapshot({
      serviceId,
      termsType,
      documentId,
      content,
      mimeType,
      fetchDate,
    });

    if (!snapshotId) {
      this.emit('snapshotNotChanged', serviceId, termsType, documentId);

      return;
    }

    this.emit(isFirstRecord ? 'firstSnapshotRecorded' : 'snapshotRecorded', serviceId, termsType, documentId, snapshotId);

    return snapshotId;
  }

  async recordVersion({ content, fetchDate, snapshotIds, serviceId, termsType, extractOnly }) {
    const { id: versionId, isFirstRecord } = await this.recorder.recordVersion({
      serviceId,
      termsType,
      content,
      fetchDate,
      snapshotIds,
      extractOnly,
    });

    if (!versionId) {
      this.emit('versionNotChanged', serviceId, termsType);

      return;
    }

    this.emit(isFirstRecord ? 'firstVersionRecorded' : 'versionRecorded', serviceId, termsType, versionId);
  }

  getNumberOfTerms(serviceIds = this.serviceIds) {
    return serviceIds.reduce((acc, serviceId) => acc + this.services[serviceId].getNumberOfTerms(), 0);
  }

  async #forEachTermsOf(servicesIds = [], termsTypes = [], callback) { // eslint-disable-line default-param-last
    servicesIds.sort((a, b) => a.localeCompare(b)); // Sort service IDs by lowercase name to have more intuitive logs
    servicesIds.forEach(serviceId => {
      this.services[serviceId].getTermsTypes().forEach(termsType => {
        if (termsTypes.length && !termsTypes.includes(termsType)) {
          return;
        }

        callback(this.services[serviceId].getTerms(termsType));
      });
    });
  }
}
