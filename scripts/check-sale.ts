import { closedb } from "../src/config/db";
import { getFlashSaleById } from "../src/db/flashSales.repo";

async function main() {
  const id = process.argv[2] ?? "1";
  const sale = await getFlashSaleById(id);

  if (!sale) {
    console.log(`No flash sale with id=${id}`);
    return;
  }
  console.log(sale);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closedb());
