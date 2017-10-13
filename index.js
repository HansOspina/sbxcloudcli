'user strict'
const prompt = require('prompt');
const optimist = require('optimist');
const async = require('async');
const request = require('request');
const fs = require('fs');
const debug = require('debug');
const path = require('path');
const recursive = require('recursive-readdir');
const querystring = require("querystring");
const zlib = require('zlib');


const ignore = [
  ".DS_Store",
  "thumbs.db",
  "*.log",
  ".*",
  "node_modules"
];

if (process.argv.length <= 3) {
  console.log('Usage: \n\t sbxcloud deploy <local-path> <folder-key> <domain-id>');
  console.log('\n\nExample: To deploy the current local folder(.) into a given sbxcloud folder with key=b5ad36e8-4b02-ae244ce79449 inside the domain with I=11: \n\t sbxcloud deploy . b5ad36e8-4b02-ae244ce79449 11');
  process.exit(-1);
}


async.waterfall([

  function (cb) {
    //
    // Start the prompt
    //
    prompt.override = optimist.argv
    prompt.start();
    prompt.message = "sbxcloud";

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
        path: path.resolve(process.argv[2]),
        folder_key: process.argv[3],
        domain_id: process.argv[4]
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

  // function (box, cb) {
  //
  //   loadApps(box.domain.domain_id, box.secure, function (err, apps) {
  //
  //     if (err) {
  //       return cb(err);
  //     }
  //
  //     cb(null, box);
  //
  //   });
  //
  // },

  function (box, cb) {

    console.log(`Deployment confirmation: 
    \n\tLocal Folder: ${box.path}
    \n\tDomain: ${box.domain.display_name}(${box.domain.domain}) Id=${box.domain.domain_id}
    \n\tRemote Folder: sbxcloud.com -> ${box.folder.folder.path}
    `);


    //  1) list all the apps for all the domains where you are a developer
    //  2) show a confirmation message
    //  3) create a .sbxcloudcli/domain-1/app-1 folder with a copy of all the items that will be deployed.
    // run dir-compare

    recursive(box.path, ignore, function (err, files) {

      if (err) {
        return cb(err);
      }

      /**
       * 1 List all the folders,
       * 2 find if all the local folders in the current directory exist
       * 3 Transfer all the files in the current folder using async.eachLimit(files,3)
       * 4 call upload folder recursively.
       * 5 NV: delete files that exist remotely but are not present locally?
       */

      box.files = files;

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
    uploadFolder('',box.path, box.files, box.folder.folder.key,box.secure, cb);
  }


], function (err) {

  if (err) {
    console.error(err);
  }

  console.log("Deploy Finished.")


});


function ignoreFunc(file, stats) {
  // `file` is the absolute path to the file, and `stats` is an `fs.Stats`
  // object returned from `fs.lstat()`.

  // if it is a directory, check that it does exist
  //stats.isDirectory() ||
  console.log(file.indexOf('.') + "-> " + file.indexOf('.'));
  return ignore[path.basename(file) || file.indexOf('.') === 0];
}


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
      callback(error?error:new Error(body.error));
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
      callback(error?error:body.error);
    } else {

      if (body.success) {
        callback(null, body);
      } else {
        callback(new Error("Unknown error"));
      }
    }
  });


}


function uploadFolder(padding, dirPath, fullList, remoteFolderKey, secureConfig, callback) {



  console.log(`${padding}|->${path.basename(dirPath)}`);


  const dirs = fs.readdirSync(dirPath).filter(f => fs.statSync(path.join(dirPath, f)).isDirectory());

  async.waterfall([

    function (cb) {
      listFolder(remoteFolderKey, secureConfig, function(err,f){
        cb(err,f);
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
        }else {
          pre.remoteFiles[f.name] = f
        }
        return pre;
      }, box);

      // check if each remote subfolder exists, if not create it.
      async.eachLimit(dirs, 3,(d, cbIter) => {

        if (box.remoteSubFolders[d]) {
          return cbIter(null);
        }

        console.log(`[CREATE] remote:${path.join(dirPath, d)}`);

        createFolder(remoteFolder.folder.key, d,secureConfig, function (err, folder) {

          if (err) {
            return cbIter(err);
          }

          box.remoteSubFolders[d] = folder.folder;

          cbIter(null);

        });

      }, function (err) {
        cb(err, box);
      });

    },
    function (box, cb) {

      if(dirs.length===0){
          return cb(null,box);
      }

      async.eachSeries(dirs, (d, cbIter) => {
        uploadFolder('\t'+padding,path.join(dirPath, d), fullList, box.remoteSubFolders[d].key, secureConfig, cbIter);
      }, err=>{cb(err,box)});

    },
    function (box, cb) {
      cb(null);
    }

  ], callback);


}
