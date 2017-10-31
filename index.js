#!/usr/bin/env node
'user strict'
const prompt = require('prompt');
const optimist = require('optimist');
const async = require('async');
const request = require('request');
const fs = require('fs');
const debug = require('debug');
const path = require('path');
const klaw = require('klaw');
const querystring = require("querystring");
const zlib = require('zlib');
const mime = require('mime-types');
const minimatch = require("minimatch");


const ignore = [
  ".DS_Store",
  "thumbs.db",
  "*.log",
  ".*",
  "node_modules"
];


function printOptions() {
  console.log('Usage: \n\t sbxcloud deploy <local-path> <folder-key> <domain-id>');
  console.log('\t Options:');
  console.log('\t\t --username=<sbxcloud-username>');
  console.log('\t\t --password=<sbxcloud-password>');
}

if (process.argv.length <= 4) {
  printOptions();
  console.log('\n\nExample: To deploy the current local folder(.) into a given sbxcloud folder with key="b5ad36e8-4b02-ae244ce79449" inside the domain with ID=11: \n\t sbxcloud deploy . b5ad36e8-4b02-ae244ce79449 11');
  process.exit(-1);
}

function processResponse(error, response, body, cb) {


  if (!error && response.statusCode === 200) {

    let encoding = response.headers['content-encoding'];

    if (encoding && encoding.indexOf('gzip') >= 0) {

      zlib.gunzip(body, function (zerr, dezipped) {

        if (zerr) {
          cb(zerr, body);
        } else {
          var json_string = dezipped.toString('utf-8');
          var json = JSON.parse(json_string);
          cb(null, json);
        }
        // Process the json..
      });

    } else {

      if (typeof body === 'string' || body instanceof String) {
        cb(null, JSON.parse(body));
      } else {
        cb(null, body);
      }


    }

  } else {
    cb(error ? error : new Error("Invalid response code:" + response.statusCode), null);
  }

}


async.waterfall([

  function (cb) {
    //
    // Start the prompt
    //
    prompt.override = optimist.argv
    prompt.start();
    prompt.message = "sbxcloud";


    if (process.argv[2] !== 'deploy') {
      return cb(new Error('Invalid option:' + process.argv[2]));
    }

    //
    // Get two properties from the user: username and password
    //
    prompt.get([{
      name: 'username',
      required: true,
    }, {
      description: 'Please enter your password',
      name: 'password',
      required: true,// Specify the type of input to expect.
      pattern: /^\w+$/,
      hidden: true,
      message: 'Password must be letters',
      replace: '*',
      conform: function (value) {
        return true;
      }
    }], function (err, result) {


      if (err) {
        prompt.stop();
        cb(err);
        return;
      }


      cb(null, {
        login: result.username,
        password: result.password,
        appfolder: result.path,
        path: path.resolve(process.argv[3]),
        folder_key: process.argv[4],
        domain_id: process.argv[5]
      });
    });

  },

  function (box, cb) {

    doLogin(box.login, box.password, function (err, jsonRes) {

      if (err) {
        return cb(err);
      }

      box.secure = jsonRes;

      cb(null, box);
    });


  },
  function (box, cb) {


    box.domain = box.secure.user.member_of.find(d => d.domain_id === parseInt(box.domain_id));

    if (!box.domain) {
      return cb(new Error(`Invalid domain Id=${box.domain_id} provided.`))
    }


    cb(null, box);
  },


  function (box, cb) {

    listFolder(box.folder_key, box.secure, function (err, folderData) {

      if (err) {
        return cb(err);
      }

      if (folderData.folder.key_path.indexOf(box.domain.home_key) <= 0) {
        return cb(new Error(`The folder-key:${box.folder_key} doesn't belong to the selected domain:${box.domain.display_namne}(${box.domain.domain}).`))
      }

      box.folder = folderData;

      cb(null, box);

    });

  },


  function (box, cb) {

    console.log(`Deployment confirmation: 
    \tLocal Folder: ${box.path}
    \tDomain: ${box.domain.display_name}(${box.domain.domain}) Id=${box.domain.domain_id}
    \tRemote Folder: sbxcloud.com -> ${box.folder.folder.path}
    `);


    //  1) list all the apps for all the domains where you are a developer
    //  2) show a confirmation message
    //  3) create a .sbxcloudcli/domain-1/app-1 folder with a copy of all the items that will be deployed.
    // run dir-compare
    const items = [];

    klaw(box.path)
      .on('data', item => {

        const valid = ignore.reduce((pre, rule) => {

          const name = path.basename(item.path);

          return !!(pre && !minimatch(name,rule));
        }, true);

        if (valid) {
          items.push(item.path);
        }

      })
      .on('end', () => {

        /**
         * 1 List all the folders,
         * 2 find if all the local folders in the current directory exist
         * 3 Transfer all the files in the current folder using async.eachLimit(files,3)
         * 4 call upload folder recursively.
         * 5 NV: delete files that exist remotely but are not present locally?
         */

        box.files = items;

        prompt.message = 'sbxcloud';

        prompt.get([{
          description: 'Is this deployment valid? (true/false)',
          name: 'confirmation',
          type: 'boolean',
          required: true,
          message: 'Invalid Option'
        }], function (err, result) {


          if (err) {
            prompt.stop();
            return cb(err);
          }

          if (!result.confirmation) {
            return cb(new Error("Deployment cancelled."));
          }

          cb(null, box);
        });

      });


  },
  function (box, cb) {
    uploadFolder('', box.path, box.files, box.folder.folder.key, box.secure, cb);
  }


], function (err) {

  if (err) {
    console.error(err.message);
    printOptions();
  }

  console.log("Deploy Finished.")


});


function doLogin(login, password, callback) {

  const tmp = {
    login: login,
    password: password
  };


  const options = {
    url: "https://sbxcloud.com/api/user/v1/login?" + querystring.stringify(tmp),
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate'
    },
    gzip: true,
    encoding: null,
    json: true
  };


  request.get(options, function (error, response, body) {

    if (error) {
      callback(error);
    } else {

      if (body.success) {
        callback(null, body);
      } else {
        callback(new Error(body.error));
      }
    }
  });


}


function loadApps(domainId, secureConfig, callback) {


  const options = {
    url: "https://sbxcloud.com/api/domain/v1/app/list?domain=" + domainId,
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Authorization': `Bearer ${secureConfig.token}`
    },
    gzip: true,
    encoding: null,
    json: true
  };


  request.get(options, function (error, response, body) {

    if (error || body.error) {
      callback(error ? error : new Error(body.error));
    } else {

      if (body.success) {
        callback(null, body);
      } else {
        callback(new Error("Unknown error:" + body.error));
      }
    }
  });


}


function createFolder(parent_key, name, secureConfig, callback) {


  const options = {
    url: `https://sbxcloud.com/api/content/v1/folder?name=${name}&parent_key=${parent_key}`,
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Authorization': `Bearer ${secureConfig.token}`
    },
    gzip: true,
    encoding: null,
    json: true
  };

  request.post(options, function (error, response, body) {


    if (error || body.error) {
      callback(error ? error : new Error(body.error));
    } else {

      if (body.success) {

        body.contents = [];
        callback(null, body);
      } else {
        callback(new Error("Unknown error"));
      }
    }
  });


}

function listFolder(folder_key, secureConfig, callback) {

  const options = {
    url: `https://sbxcloud.com/api/content/v1/folder?key=${folder_key}`,
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Authorization': `Bearer ${secureConfig.token}`
    },
    gzip: true,
    encoding: null,
    json: true
  };


  request.get(options, function (error, response, body) {

    if (error || body.error) {
      callback(error ? error : body.error);
    } else {

      if (body.success) {
        callback(null, body);
      } else {
        callback(new Error("Unknown error"));
      }
    }
  });


}

function uploadFile(folderKey, filePath, secureConfig, callback) {

  const filename = path.basename(filePath);

  const options = {
    url: `https://sbxcloud.com/api/content/v1/upload`,

    headers: {
      'Accept': 'application/json',
      'accept-encoding': 'gzip, deflate, br',
      'Authorization': `Bearer ${secureConfig.token}`
    },
    encoding: null,
    formData: {
      custom_file: {
        value: fs.createReadStream(filePath),
        options: {
          filename: filename,
          contentType: mime.lookup(filename)
        }
      },
      model: JSON.stringify({
        key: folderKey
      })
    }
  };


  request.post(options, function (error, response, body) {

    processResponse(error, response, body, function (resError, jsonRes) {

      if (!resError && jsonRes.success) {
        callback(null, jsonRes);
      } else {
        callback(resError ? resError : new Error(jsonRes.error), null);
      }


    });

  });

}


function uploadFolder(padding, dirPath, fullList, remoteFolderKey, secureConfig, callback) {

  console.log(`${padding}|->${path.basename(dirPath)}/`);
  const dirs = [];
  const files = [];

  fullList.forEach(item => {
    // if the item belongs to this folder
    if (path.dirname(item) === dirPath) {

      if (fs.statSync(path.join(item)).isDirectory()) {
        dirs.push(item);
      } else {
        files.push(item);
      }

    }

  });

  //console.log(dirPath + " has [ folders:"+dirs.length+", files:"+files.length+" ]" );

  async.waterfall([

    function (cb) {
      listFolder(remoteFolderKey, secureConfig, function (err, f) {
        cb(err, f);
      })
    },

    function (remoteFolder, cb) {

      const box = {
        remoteFolder: remoteFolder,
        remoteSubFolders: {},
        remoteFiles: {}
      };


      remoteFolder.contents.reduce((pre, f) => {

        if (f.item_type === 'F') {
          pre.remoteSubFolders[f.name] = f
        } else {
          pre.remoteFiles[f.name] = f
        }
        return pre;
      }, box);


      // check if each remote subfolder exists, if not create it.
      async.eachSeries(dirs, (d, cbIter) => {

        const dirName = path.basename(d);

        if (box.remoteSubFolders[dirName]) {
          return process.nextTick(function () {
            cbIter(null);
          });
        }

        createFolder(remoteFolder.folder.key, dirName, secureConfig, function (err, folder) {

          if (err) {
            return cbIter(err);
          }

          box.remoteSubFolders[dirName] = folder.folder;

          cbIter(null);

        });

      }, function (err) {
        cb(err, box);
      });

    },
    function (box, cb) {

      // upload up to 3 files in parallel
      async.eachLimit(
        files, 3,
        (file, cbIter) => {

          const filename = path.basename(file);
          console.log(`  ${padding}|->${filename}`);

          uploadFile(box.remoteFolder.folder.key, file, secureConfig, errIter => {
            if (errIter) {
              console.error(errIter);
            }
            cbIter(errIter);
          });
        },
        errEach => {
          cb(errEach, box);
        }
      );



    },
    function (box, cb) {

      if (dirs.length === 0) {
        return cb(null);
      }

      async.eachSeries(dirs, (d, cbIter) => {
        const dirName = path.basename(d);
        uploadFolder('  ' + padding, d, fullList, box.remoteSubFolders[dirName].key, secureConfig, cbIter);
      }, err => {
        cb(err)
      });

    }

  ], callback);


}
