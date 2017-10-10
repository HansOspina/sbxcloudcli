'user strict'
const prompt = require('prompt');
const async = require('async');
const request = require('request');
const fs = require('fs');
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
        path: path.resolve(process.argv[process.argv.length - 3]),
        folder_key: process.argv[process.argv.length - 2],
        domain_id: process.argv[process.argv.length - 1]
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


    box.domain = box.secure.user.member_of.find(d=>d.domain_id===parseInt(box.domain_id));

    if (!box.domain) {
      return cb(new Error(`Invalid domain Id=${box.domain_id} provided.`))
    }


    cb(null, box);
  },



  function (box, cb) {

    listFolder(box.folder_key, box.secure, function (err, folder) {

      if (err) {
        return cb(err);
      }

      if(folder.key_path.indexOf(box.domain.home_key)<=0){
        return cb(new Error(`The folder-key:${box.folder_key} doesn't belong to the selected domain:${box.domain.display_namne}(${box.domain.domain}).`))
      }

      box.folder = folder;

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
    \n\tRemote Folder: sbxcloud.com -> ${box.folder.path}
    `);


    //  1) list all the apps for all the domains where you are a developer
    //  2) show a confirmation message
    //  3) create a .sbxcloudcli/domain-1/app-1 folder with a copy of all the items that will be deployed.
    // run dir-compare

    recursive(box.path, ignore, function (err, files) {

      if (err) {
        return cb(err);
      }


      // console.log("Will deploy the following files to sbxcloud.com:");
      //
      // files.forEach(file => {
      //   const stat = fs.lstatSync(file);
      //   console.log(file.replace(box.path, '<path>/'));
      //
      //   //console.log(stat.mtime.getTime());
      //
      // });

      prompt.message = 'sbxcloud';

      prompt.get([{
        description:'Is this deployment valid? (true/false)',
        name: 'confirmation',
        type: 'boolean',
        required: true,
        message:'Invalid Option'
      }], function (err, result) {


        if (err) {
          prompt.stop();
          return cb(err);
        }

        if(!result.confirmation){
          return cb(new Error("Deployment cancelled."));
        }

        cb(null,box);
      });

    });

  }


], function (err) {

  if (err) {
    console.error("Error:", err.message);
  }
it

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
    url: "http://hansospina:3000/api/domain/v1/app/list?domain=" + domainId,
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


function listFolder(folder_key, secureConfig, callback) {


  const options = {
    url: `http://hansospina:3000/api/content/v1/folder?key=${folder_key}`,
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
      callback(error);
    } else {

      if (body.success) {
        callback(null, body.folder);
      } else {
        callback(new Error("Unknown error"));
      }
    }
  });


}

