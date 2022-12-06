__:warning: These scripts are no longer up-to-date with the codebase and are not guaranteed to work.__

# Rewrite history

As some terms types or service names can change over time or as we need to import history from other tools, provided they have an history with the same structure as Open Terms Archive, we need a way to rewrite, reorder and apply changes to the snapshots or versions history.

The script works by reading commits from a **source** repository, applying changes and then committing the result in another, empty or not, **target** repository. So a source repository with commits is required.

When re-writing versions, filters are re-applied on snapshots, so services declarations and history are required.

:warning: Currently, history rewriting only works with Git storage.

## Rewrite snapshots

### Configuring

You can change the **source** and **target** repository in `config/rewrite-snapshots.json`. We use the `recorder` module to write to the **target** repository, so to configure the **target** repo, change the `recorder.snapshots.storage.git.path` value:

```json
{
  …
  "recorder": {
    "snapshots": {
      "storage": {
        "git": {
          "path": "<Target repository>"
          …
        }
      }
    }
  },
  "rewrite": {
    "snapshotsSourcePath": "<Source repository>"
  }
}
```

Other configuration elements are inherited from the default `recorder` config.

### Running

Run every command by setting `NODE_ENV` to `rewrite-snapshots`.

Run the script by running:

```sh
cd scripts/rewrite
NODE_ENV=rewrite-snapshots node rewrite-snapshots.js
```

You can write in an empty target repository and initialize it by passing the options `--init`:

```sh
NODE_ENV=rewrite-snapshots node rewrite-snapshots.js --init
```

This option will create the repository if it does not exists.

:warning: **If the repository already exist it will be deleted and reinitialized by this options.**

The resulting rewritten history can be found in the configured target repository or by default in the `data/snapshots-rewritten` repository.

## Rewrite versions

### Configuring

You can change the **source** and **target** repository in `config/rewrite-versions.json`. We use the `recorder` module to write to the **target** repository, so to configure the **target** repo, change the `recorder.versions.storage.git.path` value:

```json
{
  …
  "recorder": {
    "versions": {
      "storage": {
        "git": {
          "path": "<Target repository>"
          …
        }
      }
    }
  },
  "rewrite": {
    "snapshotsSourcePath": "<Source repository>"
  }
}
```

Other configuration elements are inherited from the default `recorder` config.

### Running

Run every command by setting `NODE_ENV` to `rewrite-versions`.

Run the script by running:

```sh
cd scripts/rewrite
NODE_ENV=rewrite-versions node rewrite-versions.js
```

You can write in an empty target repository and initialize it by passing the options `--init`:

```sh
NODE_ENV=rewrite-versions node rewrite-versions.js --init
```

This option will create the repository if it does not exists.

:warning: **If the repository already exist it will be deleted and reinitialized by this options.**

The resulting rewritten history can be found in the configured target repository or by default in the `data/versions-rewritten` repository.

### Important notes

- Your source repository will be read as it, so checkout the proper branch of commit before running the script.
- If you kill the script during its run, your source repository will probably on a commit in the middle of the history, you need to manually checkout to the proper wanted commit of branche before re-running it.

## Adding renaming rules

See the [renamer module documentation](../renamer/README.md).

### Currently handled cases

Currently, the script will:

- Ignore commits which are not a document snapshot (like renaming or documentation commits)
- Reorder commits according to their author date
- Rename terms types according to declared rules
- Rename services according to declared rules
- Skip commits with empty content
- Skip commits which do not change the document
