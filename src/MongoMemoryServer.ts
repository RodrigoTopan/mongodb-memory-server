
import { ChildProcess } from 'child_process';
import tmp from 'tmp';
import getPort from 'get-port';
// import Debug from 'debug';  // TODO : Do we really need this package ?
import { generateDbName } from './util/db_util';
import MongoInstance from './util/MongoInstance';
import { MongoBinaryOpts } from './util/MongoBinary';
import { CallbackFn,
  DebugFn,
  MongoMemoryInstancePropT,
  StorageEngineT,
  SpawnOptions
} from './types';
import { SynchrounousResult } from 'tmp';

tmp.setGracefulCleanup();

export interface MongoMemoryServerOptsT {
  instance?: MongoMemoryInstancePropT;
  binary?: MongoBinaryOpts;
  debug?: boolean;
  spawn?: SpawnOptions;
  autoStart?: boolean;
}

export interface MongoInstanceDataT {
  port: number;
  dbPath: string;
  dbName: string;
  uri: string;
  storageEngine: StorageEngineT;
  instance: MongoInstance;
  childProcess: ChildProcess;
  tmpDir?: {
    name: string;
    removeCallback: CallbackFn;
  };
  replSet?: string;
}

async function generateConnectionString(port: number, dbName: string): Promise<string> {
  return `mongodb://127.0.0.1:${port}/${dbName}`;
}

export default class MongoMemoryServer {
  runningInstance: Promise<MongoInstanceDataT> | null;
  opts: MongoMemoryServerOptsT;
  debug: DebugFn;

  constructor(opts?: MongoMemoryServerOptsT) {
    this.opts = { ...opts }; // create a new object by parsing opts
    this.runningInstance = null
    // if (!this.opts.instance) this.opts.instance = {};
    // if (!this.opts.binary) this.opts.binary = {};

    this.debug = (msg: string) => {
      if (this.opts.debug) {
        console.log(msg);
      }
    };

    this.debug('Autostarting MongoDB instance...');
    this.start();

    // autoStart by default
    // TODO: Why do we do this check if it is always valid ?
    /* if (!opts.hasOwnProperty('autoStart') || opts.autoStart) {
      this.debug('Autostarting MongoDB instance...');
      this.start();
    }
    */
  }

  async start(): Promise<boolean> {
    if (this.runningInstance) {
      throw new Error(
        'MongoDB instance already in status startup/running/error. Use opts.debug = true for more info.'
      );
    }

    this.runningInstance = this._startUpInstance()
      .catch(err => {
        if (err.message === 'Mongod shutting down' || err === 'Mongod shutting down') {
          this.debug(`Mongodb does not started. Trying to start on another port one more time...`);
          if (this.opts.instance && this.opts.instance.port) {
            this.opts.instance.port = null;
          }
          return this._startUpInstance();
        }
        throw err;
      })
      .catch(err => {
        if (!this.opts.debug) {
          throw new Error(
            `${err.message}\n\nUse debug option for more info: ` +
            `new MongoMemoryServer({ debug: true })`
          );
        }
        throw err;
      });

    return this.runningInstance.then(() => true);
  }

  async _startUpInstance(): Promise<MongoInstanceDataT> {
    const data: any = {};
    let tmpDir: SynchrounousResult;

    const instOpts = this.opts.instance;
    data.port = await getPort({ port: (instOpts && instOpts.port) || undefined });
    /*
      this.debug = Debug(`Mongo[${data.port}]`); // TODO: Why do we dont just use this.debug here ?
      this.debug.enabled = !!this.opts.debug; // Useful ?
    */
    this.debug(`Mongo[${data.port}]`)
    data.dbName = generateDbName(instOpts && instOpts.dbName);
    data.uri = await generateConnectionString(data.port, data.dbName);
    data.storageEngine = (instOpts && instOpts.storageEngine) || 'ephemeralForTest';
    data.replSet = instOpts && instOpts.replSet;
    if (instOpts && instOpts.dbPath) {
      data.dbPath = instOpts.dbPath;
    } else {
      // @ts-ignore
      tmpDir = tmp.dirSync({
        discardDescriptor: true,
        mode: '0755',
        prefix: 'mongo-mem-',
        unsafeCleanup: true,
      });
      data.dbPath = tmpDir.name;
    }

    this.debug(`Starting MongoDB instance with following options: ${JSON.stringify(data)}`);

    // Download if not exists mongo binaries in ~/.mongodb-prebuilt
    // After that startup MongoDB instance
    const instance = await MongoInstance.run({
      instance: {
        dbPath: data.dbPath,
        debug: this.opts.instance && this.opts.instance.debug,
        port: data.port,
        storageEngine: data.storageEngine,
        replSet: data.replSet,
        args: this.opts.instance && this.opts.instance.args,
        auth: this.opts.instance && this.opts.instance.auth,
      },
      binary: this.opts.binary,
      spawn: this.opts.spawn,
      debug: this.debug,
    });
    data.instance = instance;
    data.childProcess = instance.childProcess;
    // data.tmpDir = tmpDir;

    return data;
  }

  async stop(): Promise<boolean> {
    const { instance, port, tmpDir }: MongoInstanceDataT = await this.getInstanceData();

    this.debug(`Shutdown MongoDB server on port ${port} with pid ${instance.getPid() || ''}`);
    await instance.kill();

    if (tmpDir) {
      this.debug(`Removing tmpDir ${tmpDir.name}`);
      tmpDir.removeCallback();
    }

    this.runningInstance = null;
    return true;
  }

  async getInstanceData(): Promise<MongoInstanceDataT> {
    if (!this.runningInstance) {
      await this.start();
    }
    if (this.runningInstance) {
      return this.runningInstance;
    }
    throw new Error(
      'Database instance is not running. You should start database by calling start() method. BTW it should start automatically if opts.autoStart!=false. Also you may provide opts.debug=true for more info.'
    );
  }

  async getUri(otherDbName: string | boolean = false): Promise<string> {
    const { uri, port }: MongoInstanceDataT = await this.getInstanceData();

    // IF true OR string
    if (otherDbName) {
      if (typeof otherDbName === 'string') {
        // generate uri with provided DB name on existed DB instance
        return generateConnectionString(port, otherDbName);
      }
      // generate new random db name
      return generateConnectionString(port, generateDbName());
    }

    return uri;
  }

  async getConnectionString(otherDbName: string | boolean = false): Promise<string> {
    return this.getUri(otherDbName);
  }

  async getPort(): Promise<number> {
    const { port }: MongoInstanceDataT = await this.getInstanceData();
    return port;
  }

  async getDbPath(): Promise<string> {
    const { dbPath }: MongoInstanceDataT = await this.getInstanceData();
    return dbPath;
  }

  async getDbName(): Promise<string> {
    const { dbName }: MongoInstanceDataT = await this.getInstanceData();
    return dbName;
  }
}
