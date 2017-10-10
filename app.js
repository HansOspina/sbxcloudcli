var program = require('commander-plus');

program
  .version('0.0.1')
  .option('-p, --path', 'The path to deploy')

  .parse(process.argv);

console.log('you ordered a pizza with:');
if (program.peppers) console.log('  - peppers');
if (program.pineapple) console.log('  - pineappe');
if (program.bbq) console.log('  - bbq');
console.log('  - %s cheese', program.cheese);