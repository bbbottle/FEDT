const fs = require('fs');
const moduleJSON = require('./module.json');
const stylesheets = moduleJSON.resources;

const readStylesheetContent = (fileName) => {
  try {
    var data = fs.readFileSync(fileName, 'utf8');
    return data.replace(/\s+/g, '');
  } catch(e) {
    console.log('Error:', e.stack);
  }
};

const generateStyleSheetsMap = (stylesheetFileNames = []) => {
  const map = {};
  stylesheetFileNames.forEach((fileName) => {
    const content = readStylesheetContent(fileName);
    map[`ui/${fileName}`] = content;
  })
  const mapStr = JSON.stringify(map, null, 2);
  const outputFileContent = `export const UIStylesheetMap = ${mapStr}`;
  const outputFileName = 'UIStylesheetMap.js';
  try {
    fs.writeFileSync(outputFileName, outputFileContent);
    console.log('generated done.')
  } catch (e) {
    console.log('Error:', e.stack);
  }
}

generateStyleSheetsMap(stylesheets);